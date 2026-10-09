import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import type { Contact, Conversation, Job, Lead, Message, Source, Stage } from "../domain.js";
import type { Studio } from "../studio/knowledge.js";
import type { Llm } from "../ai/llm.js";
import { LlmUnavailableError } from "../ai/llm.js";
import type { Messenger } from "../instagram/client.js";
import { IgError } from "../instagram/client.js";
import type { IgEvent } from "../instagram/webhook.js";
import type { Notifier } from "../notify/index.js";
import type { Renderer } from "../ebauche/render.js";
import { runAgent } from "../ai/agent.js";
import { analyseConversation, draftRelance } from "../ai/followups.js";
import { buildEbauche } from "../ebauche/generator.js";
import { computeScore, computeTemperature } from "../ai/scoring.js";
import {
  findContact,
  findContactByExternal,
  findContactByUsername,
  optOutContact,
  updateContactProfile,
  upsertContact,
} from "../db/repo/contacts.js";
import {
  findConversation,
  getOrCreateConversation,
  incrementAiTurns,
  incrementRelances,
  pauseAi,
  touchInbound,
  touchOutbound,
} from "../db/repo/conversations.js";
import {
  cancelMessages,
  cancelPlannedMessages,
  conversationHistory,
  findMessage,
  findMessageByExternal,
  insertMessage,
  markFailed,
  markSent,
} from "../db/repo/messages.js";
import { getLead, updateLead } from "../db/repo/leads.js";
import { cancelJobs, enqueue } from "../db/repo/jobs.js";
import {
  claimComment,
  findCommentReplyByUsername,
  findProspectByInstagram,
  getEbauche,
  listCommentRules,
  logEvent,
  markCommentHandled,
  updateProspect,
  type CommentRule,
} from "../db/repo/misc.js";
import { planDelivery, profileFor, type DeliveryStep } from "./pacing.js";
import { dashboardStats } from "../db/repo/stats.js";
import { canSendAutomated, relanceFits } from "./window.js";
import { MAX_ATTEMPTS } from "./worker.js";
import { isTeamAction } from "../ai/tool-logic.js";
import { addMs, defaultRng, errorMessage, sleep, type Clock, type Rng } from "../util/index.js";
import { log } from "../logger.js";

export interface EngineDeps {
  db: Db;
  cfg: Config;
  studio: Studio;
  llm: Llm | null;
  messenger: Messenger;
  /** Messager du bac à sable : les réponses restent dans la base, rien ne part sur Instagram. */
  sandboxMessenger: Messenger;
  notifier: Notifier;
  renderer: Renderer | null;
  clock: Clock;
  rng?: Rng;
  /** Attente réelle (remplaçable en test). */
  wait?: (ms: number) => Promise<void>;
}

/**
 * Demande d'arrêt explicite, et rien d'autre dans le message (« Stop », « Arrête de m'écrire »,
 * « Ne m'écris plus svp »). « Arrête, c'est trop bien ! » ou « Stop motion ? » ne désinscrivent pas :
 * les cas moins nets sont laissés à l'IA, qui appelle l'outil `desinscrire` si besoin.
 */
export const OPT_OUT =
  /^\s*(stop|unsubscribe|d[ée]sinscri(?:s|vez)[- ]?moi|d[ée]sabonne[- ]?moi|arr[eê]te(?:z)? de m'?[ée]crire|arr[eê]te(?:z)? les messages|ne m'?[ée]cri(?:s|vez) plus|laisse(?:z)?[- ]moi tranquille)\s*(?:,?\s*(?:svp|stp|s'il (?:te|vous) pla[iî]t|merci))?\s*[.!]*\s*$/i;
const TERMINAL_STAGES = new Set(["perdu", "non_qualifie", "desinscrit", "gagne", "rdv_pris"]);

/**
 * Une réponse au prospect, envoyée ou en cours d'envoi. Les messages système (aperçu d'ébauche,
 * confirmation de désinscription) ne répondent pas à sa question : ils ne comptent pas.
 */
function isReply(m: Pick<Message, "direction" | "status" | "payload">): boolean {
  return m.direction === "sortant" && (m.status === "envoye" || m.status === "planifie") && m.payload?.systeme !== true;
}

const PUBLIC_REPLIES = [
  "Je t'ai répondu en privé 📩",
  "Regarde tes messages privés 😉",
  "C'est parti, je t'écris en DM !",
  "Message privé envoyé ✉️",
  "Je t'envoie tout ça en DM 🙌",
];

export class Engine {
  private rng: Rng;
  private wait: (ms: number) => Promise<void>;

  constructor(private d: EngineDeps) {
    this.rng = d.rng ?? defaultRng;
    this.wait = d.wait ?? sleep;
  }

  private messengerFor(conv: Pick<Conversation, "channel">): Messenger {
    return conv.channel === "bac_a_sable" ? this.d.sandboxMessenger : this.d.messenger;
  }

  private now(): Date {
    return this.d.clock.now();
  }

  /* =========================== Webhooks =========================== */

  /** Traite les événements d'un webhook ; renvoie le nombre d'échecs (Meta renverra alors le webhook). */
  async handleEvents(events: IgEvent[]): Promise<{ failed: number }> {
    let failed = 0;
    for (const ev of events) {
      try {
        await this.handleEvent(ev);
      } catch (err) {
        failed++;
        log.error("événement Instagram non traité", { kind: ev.kind, error: err });
        await logEvent(this.d.db, "erreur_webhook", { kind: ev.kind, error: errorMessage(err) }).catch(() => undefined);
      }
    }
    return { failed };
  }

  private async handleEvent(ev: IgEvent): Promise<void> {
    const ownId = this.d.cfg.IG_ACCOUNT_ID;
    switch (ev.kind) {
      case "message": {
        if (ev.isEcho) return this.onEcho(ev.recipientId, ev.mid, ev.text, ev.timestamp);
        if (ownId && ev.senderId === ownId) return;
        if (ev.isDeleted) {
          const m = await findMessageByExternal(this.d.db, ev.mid);
          if (m) await logEvent(this.d.db, "message_supprime", { messageId: m.id }, { conversationId: m.conversation_id });
          return;
        }
        let kind: Message["kind"] = "texte";
        let source: Source = "dm";
        const payload: Record<string, unknown> = {};
        if (ev.storyMention) {
          kind = "story_mention";
          source = "mention";
          payload.storyUrl = ev.storyMention.url;
        } else if (ev.storyReply) {
          kind = "story_reply";
          source = "story";
          payload.storyUrl = ev.storyReply.url;
          payload.storyId = ev.storyReply.id;
        } else if (ev.attachments.length) {
          kind = ev.attachments.some((a) => a.type === "image") && !ev.text ? "image" : "pieces";
          payload.attachmentType = ev.attachments.map((a) => a.type).join(", ");
          payload.attachments = ev.attachments;
        }
        if (ev.quickReplyPayload) payload.quickReply = ev.quickReplyPayload;
        if (ev.referral) {
          payload.referral = ev.referral;
          if (ev.referral.source?.toUpperCase() === "ADS") {
            source = "pub";
            if (ev.referral.adTitle) payload.adTitle = ev.referral.adTitle;
          }
        }
        if (ev.isUnsupported && !ev.text) payload.unsupported = true;
        await this.onInbound({
          channel: "instagram",
          externalUserId: ev.senderId,
          mid: ev.mid,
          text: ev.text || (ev.isUnsupported ? "[Message dans un format que je ne peux pas lire]" : ""),
          kind,
          payload,
          source,
          at: ev.timestamp,
        });
        return;
      }
      case "postback":
        await this.onInbound({
          channel: "instagram",
          externalUserId: ev.senderId,
          mid: ev.mid ?? null,
          text: ev.title || ev.payload,
          kind: "postback",
          payload: { title: ev.title, payload: ev.payload, referral: ev.referral },
          source: ev.payload.startsWith("ICE:") ? "ice_breaker" : "dm",
          at: ev.timestamp,
        });
        return;
      case "referral": {
        const contact = await findContactByExternal(this.d.db, "instagram", ev.senderId);
        await logEvent(this.d.db, "referral", { ...ev.referral, senderId: ev.senderId }, { contactId: contact?.id });
        return;
      }
      case "reaction": {
        const m = await findMessageByExternal(this.d.db, ev.mid);
        if (m) await logEvent(this.d.db, "reaction", { emoji: ev.reaction, action: ev.action, messageId: m.id }, { conversationId: m.conversation_id });
        return;
      }
      case "seen":
        return;
      case "comment":
        if (ownId && ev.fromId === ownId) return;
        await enqueue(this.d.db, "commentaire", { ...ev, timestamp: ev.timestamp.toISOString() }, { runAt: this.now(), dedupeKey: `commentaire:${ev.commentId}` });
        return;
    }
  }

  /** Point d'entrée commun : Instagram, bouton, bac à sable. */
  async onInbound(m: {
    channel: "instagram" | "bac_a_sable";
    externalUserId: string;
    mid: string | null;
    text: string;
    kind: Message["kind"];
    payload: Record<string, unknown>;
    source: Source;
    at: Date;
    username?: string;
  }): Promise<{ conversationId: string; messageId: string } | null> {
    const { db } = this.d;
    const { contact, created } = await upsertContact(db, m.channel, m.externalUserId, { username: m.username });
    let source = m.source;
    let sourceRef: string | null = null;
    let current = contact;
    if (created && m.channel === "instagram") {
      current = await this.fetchProfile(contact);
      // La personne répond-elle à une accroche envoyée par l'équipe, ou à un commentaire ?
      if (current.username) {
        const prospect = await findProspectByInstagram(db, current.username);
        if (prospect) {
          source = "sortant";
          sourceRef = prospect.company_name ?? prospect.person_name ?? prospect.id;
          await updateProspect(db, prospect.id, { status: "a_repondu", contact_id: contact.id });
          await logEvent(db, "prospect_a_repondu", { prospectId: prospect.id }, { contactId: contact.id });
        } else {
          const c = await findCommentReplyByUsername(db, current.username);
          if (c) {
            source = "commentaire";
            sourceRef = c.media_id;
          }
        }
      }
    }
    const { conversation } = await getOrCreateConversation(db, contact.id, m.channel, source, sourceRef);
    const msg = await insertMessage(db, {
      conversation_id: conversation.id,
      direction: "entrant",
      author: "prospect",
      kind: m.kind,
      text: m.text,
      payload: m.payload,
      external_id: m.mid,
      created_at: m.at,
    });
    if (!msg) {
      // Webhook rejoué : si le premier passage a échoué avant de programmer la réponse, on la programme.
      await this.repairReplay(m.mid, conversation, current);
      return null;
    }
    await touchInbound(db, conversation.id, m.at);
    if (!conversation.last_inbound_at || new Date(conversation.last_inbound_at) < m.at) conversation.last_inbound_at = m.at;
    await cancelJobs(db, { types: ["relancer"], conversationId: conversation.id });
    const lead = await getLead(db, contact.id);
    if (created) await logEvent(db, "nouveau_contact", { source }, { contactId: contact.id, conversationId: conversation.id });

    if (current.opted_out_at) {
      await this.notify(conversation, current, lead, "desinscrit_reecrit", "Un contact désinscrit vous réécrit", `Message : « ${m.text.slice(0, 200)} »\nL'IA ne répond pas : à traiter à la main.`);
      return { conversationId: conversation.id, messageId: msg.id };
    }
    if (m.text.length <= 60 && OPT_OUT.test(m.text)) {
      await optOutContact(db, contact.id);
      await updateLead(db, contact.id, { stage: "desinscrit", score: 0, temperature: "froid" });
      await logEvent(db, "desinscription", { via: "mot_cle" }, { contactId: contact.id, conversationId: conversation.id });
      await this.sendSystemText(conversation, current, "C'est noté, je ne t'écrirai plus. Belle continuation 🙏");
      return { conversationId: conversation.id, messageId: msg.id };
    }
    if (conversation.ai_paused_until && new Date(conversation.ai_paused_until) > this.now()) {
      await this.notify(conversation, current, lead, "message_reprise_humaine", "Nouveau message (conversation reprise par l'équipe)", `« ${m.text.slice(0, 300)} »`);
      return { conversationId: conversation.id, messageId: msg.id };
    }
    const profile = profileFor(this.d.cfg.PACING_PROFILE, m.channel === "bac_a_sable" ? Math.min(2, this.d.cfg.REPLY_DEBOUNCE_SECONDS) : this.d.cfg.REPLY_DEBOUNCE_SECONDS);
    await enqueue(
      db,
      "repondre",
      { conversationId: conversation.id, triggerMessageId: msg.id },
      { runAt: addMs(this.now(), profile.debounceMs), dedupeKey: `repondre:${conversation.id}`, replace: true },
    );
    return { conversationId: conversation.id, messageId: msg.id };
  }

  private async repairReplay(mid: string | null, conversation: Conversation, contact: Contact): Promise<void> {
    if (!mid || contact.opted_out_at) return;
    if (conversation.ai_paused_until && new Date(conversation.ai_paused_until) > this.now()) return;
    const original = await findMessageByExternal(this.d.db, mid);
    if (!original || original.conversation_id !== conversation.id || original.direction !== "entrant") return;
    const answered = await this.d.db.one<{ id: string }>(
      "SELECT id FROM messages WHERE conversation_id = $1 AND direction = 'sortant' AND status IN ('envoye', 'planifie') AND created_at >= $2 LIMIT 1",
      [conversation.id, original.created_at],
    );
    if (answered) return;
    // Le premier passage a pu s'arrêter avant d'enregistrer l'heure du message (fenêtre de 24 h)
    // et d'annuler les relances : on le refait, ces deux opérations sont sans effet si déjà faites.
    await touchInbound(this.d.db, conversation.id, new Date(original.created_at));
    await cancelJobs(this.d.db, { types: ["relancer"], conversationId: conversation.id });
    // Sans `replace` : une réponse déjà programmée ou en cours garde son calendrier.
    await enqueue(this.d.db, "repondre", { conversationId: conversation.id, triggerMessageId: original.id }, {
      runAt: addMs(this.now(), this.d.cfg.REPLY_DEBOUNCE_SECONDS * 1000),
      dedupeKey: `repondre:${conversation.id}`,
    });
  }

  private async fetchProfile(contact: Contact): Promise<Contact> {
    if (!contact.external_id) return contact;
    try {
      const p = await this.d.messenger.getProfile(contact.external_id);
      if (!p) return contact;
      await updateContactProfile(this.d.db, contact.id, p);
      return (await findContact(this.d.db, contact.id)) ?? contact;
    } catch (err) {
      log.warn("profil non récupéré", { error: errorMessage(err) });
      return contact;
    }
  }

  /** Écho d'un message envoyé depuis le compte : si ce n'est pas nous, c'est l'équipe qui a repris la main. */
  private async onEcho(userId: string, mid: string, text: string, at: Date): Promise<void> {
    const { db, cfg } = this.d;
    if (await findMessageByExternal(db, mid)) return;
    const contact = await findContactByExternal(db, "instagram", userId);
    if (!contact) return;
    const { conversation } = await getOrCreateConversation(db, contact.id, "instagram", "dm");
    // L'écho peut arriver avant que l'API nous ait renvoyé l'identifiant : on compare le texte
    // (ou, pour une image envoyée par le moteur, le type). Le message reconnu garde l'identifiant.
    const recent = await db.query<Message>(
      `SELECT * FROM messages WHERE conversation_id = $1 AND direction = 'sortant' AND author IN ('ia', 'systeme', 'humain')
         AND external_id IS NULL AND status IN ('planifie', 'envoye') AND created_at > $2
         AND (text = $3 OR ($3 = '' AND kind = 'image'))
       ORDER BY created_at DESC LIMIT 1`,
      [conversation.id, addMs(at, -5 * 60_000), text],
    );
    if (recent.length) {
      await db.query("UPDATE messages SET external_id = $2 WHERE id = $1 AND external_id IS NULL", [recent[0]!.id, mid]).catch(() => undefined);
      return;
    }
    await insertMessage(db, {
      conversation_id: conversation.id,
      direction: "sortant",
      author: "humain",
      text,
      external_id: mid,
      status: "envoye",
      created_at: at,
      sent_at: at,
    });
    await touchOutbound(db, conversation.id, at);
    await pauseAi(db, conversation.id, addMs(this.now(), cfg.HUMAN_TAKEOVER_PAUSE_HOURS * 3_600_000));
    await cancelJobs(db, { types: ["repondre", "envoyer", "relancer"], conversationId: conversation.id });
    await cancelPlannedMessages(db, conversation.id);
    await logEvent(db, "reprise_humaine", { pauseHeures: cfg.HUMAN_TAKEOVER_PAUSE_HOURS }, { contactId: contact.id, conversationId: conversation.id });
  }

  /* =========================== Tâches =========================== */

  async runJob(job: Job): Promise<void> {
    const p = job.payload as Record<string, unknown>;
    switch (job.type) {
      case "repondre":
        return this.jobRepondre(String(p.conversationId), job.attempts);
      case "envoyer":
        return this.jobEnvoyer(p as unknown as SendPayload, job.attempts);
      case "relancer":
        return this.jobRelancer(p as unknown as RelancePayload);
      case "analyser":
        return this.jobAnalyser(String(p.conversationId));
      case "ebauche":
        return this.jobEbauche(String(p.ebaucheId));
      case "notifier":
        return this.jobNotifier(p);
      case "commentaire":
        return this.jobCommentaire(p);
      case "profil": {
        const c = await findContact(this.d.db, String(p.contactId));
        if (c) await this.fetchProfile(c);
        return;
      }
      case "prospects_scan":
        // Programmée par le planificateur (src/prospects) : rien à faire ici.
        return;
    }
  }

  private async load(conversationId: string): Promise<{ conversation: Conversation; contact: Contact; lead: Lead } | null> {
    const conversation = await findConversation(this.d.db, conversationId);
    if (!conversation) return null;
    const contact = await findContact(this.d.db, conversation.contact_id);
    if (!contact) return null;
    const lead = await getLead(this.d.db, contact.id);
    return { conversation, contact, lead };
  }

  /** Programme (ou garde) la réponse à venir, avec le délai de regroupement des messages. */
  private async scheduleReply(conversationId: string, replace: boolean): Promise<void> {
    await enqueue(this.d.db, "repondre", { conversationId }, {
      runAt: addMs(this.now(), this.d.cfg.REPLY_DEBOUNCE_SECONDS * 1000),
      dedupeKey: `repondre:${conversationId}`,
      replace,
    });
  }

  private async jobRepondre(conversationId: string, attempts = 1): Promise<void> {
    const { db, cfg, studio } = this.d;
    const loaded = await this.load(conversationId);
    if (!loaded) return;
    const { conversation, contact, lead } = loaded;
    const now = this.now();
    const startedAt = now;
    const isSandbox = conversation.channel === "bac_a_sable";

    if (contact.opted_out_at) return;
    if (conversation.ai_paused_until && new Date(conversation.ai_paused_until) > now) return;
    if (!isSandbox && !canSendAutomated(conversation.last_inbound_at, now)) {
      await logEvent(db, "fenetre_fermee", {}, { conversationId, contactId: contact.id });
      return;
    }
    const history = await conversationHistory(db, conversationId, 60);
    const lastIn = [...history].reverse().find((m) => m.direction === "entrant");
    // Déjà répondu : une réponse envoyée, ou en cours d'envoi, est plus récente que le dernier message reçu.
    const lastOut = [...history].reverse().find((m) => isReply(m));
    if (!lastIn || (lastOut && new Date(lastOut.created_at) > new Date(lastIn.created_at))) return;
    if (conversation.ai_turns >= cfg.MAX_AI_TURNS_PER_CONVERSATION) {
      await pauseAi(db, conversationId, addMs(now, 7 * 86_400_000));
      await this.notify(conversation, contact, lead, "limite_ia", "Conversation très longue : l'IA passe la main", "Le nombre maximal d'échanges automatiques est atteint.", true);
      return;
    }
    if (!this.d.llm) {
      await this.notify(conversation, contact, lead, "ia_non_configuree", "IA non configurée : message à traiter à la main", `« ${(lastIn.text ?? "").slice(0, 300)} »`, true);
      return;
    }

    if (!isSandbox) await this.messengerFor(conversation).senderAction(contact.external_id!, "mark_seen").catch(() => undefined);

    const ebauche = lead.ebauche_id ? ((await getEbauche(db, lead.ebauche_id)) ?? null) : null;
    let out;
    try {
      out = await runAgent({ conversation, contact, lead, history, ebauche }, { db, cfg, llm: this.d.llm, studio, clock: this.d.clock });
    } catch (err) {
      if (err instanceof LlmUnavailableError) {
        const last = attempts >= MAX_ATTEMPTS;
        // Une alerte au premier échec, une à l'abandon : pas une à chaque nouvelle tentative.
        if (attempts === 1 || last) {
          await this.notify(
            conversation,
            contact,
            lead,
            "ia_indisponible",
            last ? "IA indisponible : message resté sans réponse" : "IA momentanément indisponible",
            `${last ? "À traiter à la main." : "Nouvelle tentative automatique dans quelques minutes."}\n${err.message}\nDernier message : « ${(lastIn.text ?? "").slice(0, 300)} »`,
            last,
          );
        }
      }
      throw err; // la tâche sera retentée
    }

    // L'IA a pu elle-même passer la main ou désinscrire la personne : son dernier message doit partir.
    const ownStop = out.actions.some((a) => a.type === "relai_humain" || a.type === "desinscription");

    // Pendant la génération, la situation a pu changer : on vérifie avant d'enregistrer quoi que ce soit.
    const freshConv = await findConversation(db, conversationId);
    const freshContact = await findContact(db, contact.id);
    const pausedNow = !!freshConv?.ai_paused_until && new Date(freshConv.ai_paused_until) > this.now();
    if (!ownStop && (pausedNow || freshContact?.opted_out_at || freshConv?.status !== "ouverte")) {
      await logEvent(db, "reponse_abandonnee", { raison: "reprise humaine, désinscription ou conversation close pendant la génération" }, { conversationId, contactId: contact.id });
      return;
    }
    const fresh = await conversationHistory(db, conversationId, 10);
    const newestIn = [...fresh].reverse().find((m) => m.direction === "entrant");
    if (!ownStop && newestIn && newestIn.id !== lastIn.id) {
      // La personne a écrit pendant qu'on préparait la réponse : on recommence avec tout le contexte,
      // après le délai de regroupement (elle est peut-être encore en train d'écrire).
      await this.scheduleReply(conversationId, true);
      return;
    }
    const answeredMeanwhile = fresh.some((m) => isReply(m) && new Date(m.created_at) > new Date(lastIn.created_at));
    if (answeredMeanwhile) return;

    await incrementAiTurns(db, conversationId);
    if (out.noteEquipe) {
      await logEvent(db, "note_ia", { note: out.noteEquipe }, { conversationId, contactId: contact.id });
    }
    if (!out.messages.length) return;

    const ids: string[] = [];
    for (const [i, text] of out.messages.entries()) {
      const isLast = i === out.messages.length - 1;
      const row = await insertMessage(db, {
        conversation_id: conversationId,
        direction: "sortant",
        author: "ia",
        text,
        status: "planifie",
        payload: { model: out.model, ...(ownStop ? { final: true } : {}), ...(isLast && out.boutons.length ? { boutons: out.boutons } : {}) },
        created_at: new Date(this.now().getTime() + i),
      });
      if (row) ids.push(row.id);
    }
    if (!ids.length) return;
    const profile = profileFor(cfg.PACING_PROFILE, cfg.REPLY_DEBOUNCE_SECONDS);
    const elapsed = this.now().getTime() - new Date(lastIn.created_at).getTime();
    const plan = isSandbox ? planDelivery(out.messages, profileFor("rapide", 0), this.rng, elapsed) : planDelivery(out.messages, profile, this.rng, elapsed);
    await enqueue(
      db,
      "envoyer",
      { conversationId, messageIds: ids, plan, afterInboundId: lastIn.id, startedAt: startedAt.toISOString() },
      { runAt: this.now(), dedupeKey: `envoyer:${ids[0]}` },
    );

    // Relance programmée seulement si elle a du sens et tient dans la fenêtre de 24 h.
    const refreshed = await getLead(db, contact.id);
    if (!ownStop && out.relanceUtile && !TERMINAL_STAGES.has(refreshed.stage) && refreshed.budget_status !== "insuffisant" && cfg.relanceDelaysMs.length && !isSandbox) {
      const at = addMs(this.now(), cfg.relanceDelaysMs[0]!);
      if (relanceFits(conversation.last_inbound_at, at)) {
        await enqueue(
          db,
          "relancer",
          { conversationId, numero: 1, total: cfg.relanceDelaysMs.length, afterInboundAt: new Date(lastIn.created_at).toISOString() },
          { runAt: at, dedupeKey: `relancer:${conversationId}`, replace: true },
        );
      }
    }
    // Analyse « après » une fois la conversation retombée.
    await enqueue(db, "analyser", { conversationId }, { runAt: addMs(this.now(), isSandbox ? 60_000 : 30 * 60_000), dedupeKey: `analyser:${conversationId}`, replace: true });
  }

  /**
   * Peut-on encore envoyer ce message, maintenant ? Nouveau message reçu, reprise humaine,
   * désinscription, fenêtre de 24 h. Le dernier message de l'IA quand elle passe la main ou
   * désinscrit la personne (`final`) part malgré la pause et la désinscription qu'elle vient de poser.
   */
  private async deliveryCheck(conversation: Conversation, contactId: string, afterInboundId: string, final: boolean): Promise<"ok" | "nouveau_message" | "stop"> {
    const { db } = this.d;
    const conv = await findConversation(db, conversation.id);
    const windowOk = conversation.channel === "bac_a_sable" || canSendAutomated(conv?.last_inbound_at ?? null, this.now());
    if (!windowOk) return "stop";
    if (final) return "ok";
    const freshContact = await findContact(db, contactId);
    const paused = !!conv?.ai_paused_until && new Date(conv.ai_paused_until) > this.now();
    if (paused || freshContact?.opted_out_at) return "stop";
    const newer = await db.one<{ id: string }>(
      "SELECT id FROM messages WHERE conversation_id = $1 AND direction = 'entrant' AND created_at > (SELECT created_at FROM messages WHERE id = $2) LIMIT 1",
      [conversation.id, afterInboundId],
    );
    return newer ? "nouveau_message" : "ok";
  }

  private async jobEnvoyer(p: SendPayload, attempts = 1): Promise<void> {
    const { db, cfg } = this.d;
    const loaded = await this.load(p.conversationId);
    if (!loaded) return;
    const { conversation, contact } = loaded;
    const messenger = this.messengerFor(conversation);
    const isSandbox = conversation.channel === "bac_a_sable";
    for (const [i, id] of p.messageIds.entries()) {
      const msg = await findMessage(db, id);
      if (!msg || msg.status !== "planifie") continue;
      const final = msg.payload.final === true;
      const step: DeliveryStep = p.plan[i] ?? { waitBeforeTypingMs: 0, typingMs: 0 };
      if (step.waitBeforeTypingMs) await this.wait(step.waitBeforeTypingMs);

      // Contrôles avant d'afficher « en train d'écrire », puis à nouveau juste avant l'envoi.
      let check = await this.deliveryCheck(conversation, contact.id, p.afterInboundId, final);
      if (check === "ok") {
        if (cfg.IG_TYPING_INDICATOR && step.typingMs > 0 && !isSandbox) {
          await messenger.senderAction(contact.external_id!, "typing_on").catch(() => undefined);
        }
        if (step.typingMs) await this.wait(step.typingMs);
        check = await this.deliveryCheck(conversation, contact.id, p.afterInboundId, final);
      }
      if (check !== "ok") {
        await cancelMessages(db, p.messageIds);
        // La personne a écrit entre-temps : une réponse est déjà programmée par son message ;
        // on s'assure qu'elle existe, sans avancer le délai de regroupement.
        if (check === "nouveau_message") await this.scheduleReply(conversation.id, false);
        return;
      }
      try {
        const buttons = Array.isArray(msg.payload.boutons) ? (msg.payload.boutons as string[]) : [];
        const res = await messenger.sendText(contact.external_id!, msg.text ?? "", buttons);
        await markSent(db, msg.id, res.messageId, this.now());
        await touchOutbound(db, conversation.id, this.now());
      } catch (err) {
        const transient = !(err instanceof IgError) || err.isTransient;
        if (transient && attempts < MAX_ATTEMPTS) {
          // Erreur passagère (réseau, limite de débit) : le message reste à envoyer, la tâche sera retentée.
          await logEvent(db, "envoi_reporte", { error: errorMessage(err), tentative: attempts }, { conversationId: conversation.id, contactId: contact.id });
          throw err;
        }
        await markFailed(db, msg.id, errorMessage(err));
        await cancelMessages(db, p.messageIds);
        // Rien n'est parti : pas de relance sur un message que la personne n'a jamais reçu.
        await cancelJobs(db, { types: ["relancer"], conversationId: conversation.id });
        if (err instanceof IgError && err.isAuth) {
          await this.notify(conversation, contact, loaded.lead, "instagram_auth", "Jeton Instagram invalide : les messages ne partent plus", err.message, true);
          return;
        }
        await logEvent(db, "envoi_impossible", { error: errorMessage(err), code: err instanceof IgError ? err.code : null, subcode: err instanceof IgError ? err.subcode : null }, { conversationId: conversation.id, contactId: contact.id });
        await this.notify(conversation, contact, loaded.lead, "envoi_impossible", "Message non délivré : à reprendre à la main", `${errorMessage(err)}\nMessage prévu : « ${(msg.text ?? "").slice(0, 300)} »`, true);
        return;
      }
    }
  }

  private async jobRelancer(p: RelancePayload): Promise<void> {
    const { db, cfg, studio } = this.d;
    const loaded = await this.load(p.conversationId);
    if (!loaded || !this.d.llm) return;
    const { conversation, contact, lead } = loaded;
    const now = this.now();
    const lastInbound = conversation.last_inbound_at ? new Date(conversation.last_inbound_at) : null;
    if (!lastInbound || lastInbound.getTime() > new Date(p.afterInboundAt).getTime()) return; // la personne a répondu
    if (contact.opted_out_at || TERMINAL_STAGES.has(lead.stage) || lead.budget_status === "insuffisant") return;
    if (conversation.ai_paused_until && new Date(conversation.ai_paused_until) > now) return;
    if (!relanceFits(lastInbound, now)) return;
    if (conversation.relances_sent >= p.total) return;

    const history = await conversationHistory(db, conversation.id, 60);
    const draft = await draftRelance({ llm: this.d.llm, cfg, studio, clock: this.d.clock }, { conversation, contact, lead, history, numero: p.numero, total: p.total });
    await logEvent(db, draft.envoyer ? "relance_programmee" : "relance_ignoree", { numero: p.numero, raison: draft.raison }, { conversationId: conversation.id, contactId: contact.id });
    if (draft.envoyer && draft.message) {
      const row = await insertMessage(db, { conversation_id: conversation.id, direction: "sortant", author: "ia", text: draft.message, status: "planifie", payload: { relance: p.numero }, created_at: now });
      if (row) {
        const lastInMsg = [...history].reverse().find((m) => m.direction === "entrant");
        const plan = planDelivery([draft.message], profileFor(cfg.PACING_PROFILE, 0), this.rng, 0);
        await enqueue(db, "envoyer", { conversationId: conversation.id, messageIds: [row.id], plan, afterInboundId: lastInMsg?.id ?? row.id, startedAt: now.toISOString() }, { runAt: now, dedupeKey: `envoyer:${conversation.id}` });
        await incrementRelances(db, conversation.id);
      }
    }
    const nextDelay = cfg.relanceDelaysMs[p.numero];
    if (draft.envoyer && p.numero < p.total && nextDelay !== undefined) {
      const firstDelay = cfg.relanceDelaysMs[p.numero - 1] ?? 0;
      const at = addMs(now, Math.max(60_000, nextDelay - firstDelay));
      if (relanceFits(lastInbound, at)) {
        await enqueue(db, "relancer", { ...p, numero: p.numero + 1 }, { runAt: at, dedupeKey: `relancer:${conversation.id}`, replace: true });
      }
    }
  }

  private async jobAnalyser(conversationId: string): Promise<void> {
    const { db, cfg, studio } = this.d;
    const loaded = await this.load(conversationId);
    if (!loaded || !this.d.llm) return;
    const { conversation, contact, lead } = loaded;
    const history = await conversationHistory(db, conversationId, 80);
    if (history.length < 2) return;
    const a = await analyseConversation({ llm: this.d.llm, cfg, studio }, { conversation, contact, lead, history });
    const score = computeScore({ fiche: lead.fiche, budget: lead.budget_status, stage: lead.stage, hasEmail: !!contact.email });
    await updateLead(db, contact.id, {
      summary: a.resume,
      // Les actions laissées par les outils (RDV à confirmer, réponse humaine, effacement RGPD…) restent.
      next_action: isTeamAction(lead.next_action) ? lead.next_action : a.prochaine_action,
      manual_followup: a.relance_manuelle || null,
      score,
      temperature: computeTemperature(score, lead.budget_status, lead.stage),
    });
    await logEvent(db, "analyse", { temperature: a.temperature, signaux: a.signaux, risques: a.risques }, { conversationId, contactId: contact.id });
  }

  private async jobEbauche(ebaucheId: string): Promise<void> {
    const { db, cfg, studio } = this.d;
    if (!this.d.llm) return;
    const res = await buildEbauche({ db, llm: this.d.llm, cfg, studio, renderer: this.d.renderer }, ebaucheId);
    const eb = await getEbauche(db, ebaucheId);
    if (!eb?.contact_id) return;
    const contact = await findContact(db, eb.contact_id);
    const conversation = eb.conversation_id ? await findConversation(db, eb.conversation_id) : undefined;
    if (!contact || !conversation) return;
    const lead = await getLead(db, contact.id);
    const link = `${cfg.PUBLIC_BASE_URL}/cockpit/ebauches/${ebaucheId}`;
    if (!res.ok) {
      await this.notify(conversation, contact, lead, "ebauche_echec", "Ébauche automatique en échec", `À préparer à la main avant l'appel.\n${eb.error ?? ""}`, true);
      return;
    }
    await logEvent(db, "ebauche_prete", { ebaucheId }, { conversationId: conversation.id, contactId: contact.id });
    await this.notify(conversation, contact, lead, "ebauche_prete", `Ébauche prête : ${eb.brief?.nom_app ?? "projet"}`, `${eb.brief?.promesse ?? ""}\n${link}`);

    // Teaser envoyé au prospect si configuré : fenêtre ouverte, personne toujours en lice (ni désinscrite,
    // ni close, ni rendez-vous déjà pris) et IA pas en pause.
    const teaserAllowed =
      cfg.EBAUCHE_TEASER !== "aucun" &&
      !contact.opted_out_at &&
      !TERMINAL_STAGES.has(lead.stage) &&
      conversation.channel === "instagram" &&
      canSendAutomated(conversation.last_inbound_at, this.now()) &&
      !(conversation.ai_paused_until && new Date(conversation.ai_paused_until) > this.now());
    if (teaserAllowed) {
      const mediaId = cfg.EBAUCHE_TEASER === "flou" ? res.mediaIds[1] : res.mediaIds[0];
      if (mediaId && contact.external_id) {
        const url = `${cfg.PUBLIC_BASE_URL}/media/${mediaId}`;
        // L'image est enregistrée avant l'envoi : son écho ne doit pas passer pour une reprise humaine.
        const row = await insertMessage(db, { conversation_id: conversation.id, direction: "sortant", author: "ia", kind: "image", text: "", payload: { image: url, teaser: true, systeme: true }, status: "planifie", created_at: this.now() });
        try {
          const sent = await this.d.messenger.sendImage(contact.external_id, url);
          if (row) await markSent(db, row.id, sent.messageId, this.now());
          await this.sendSystemText(
            conversation,
            contact,
            cfg.EBAUCHE_TEASER === "flou"
              ? `Petit aperçu de ta première ébauche 👀 On te la montre en entier en ${studio.vars.DUREE_APPEL} min de visio.`
              : `Voilà un premier aperçu de ton app ✨ On t'explique tout en ${studio.vars.DUREE_APPEL} min de visio.`,
          );
        } catch (err) {
          if (row) await markFailed(db, row.id, errorMessage(err));
          log.warn("teaser non envoyé", { error: errorMessage(err) });
        }
      }
    }
  }

  private async jobNotifier(p: Record<string, unknown>): Promise<void> {
    if (p.digest) {
      const s = await dashboardStats(this.d.db, this.now());
      const pct = (x: number) => `${Math.round(x * 100)} %`;
      const body = [
        `Conversations : ${s.conversations7j} (dont ${s.nouveauxContacts7j} nouveaux contacts)`,
        `Budgets validés : ${s.qualifies7j} · Ébauches : ${s.ebauches7j}`,
        `RDV proposés : ${s.rdvProposes7j} · RDV pris : ${s.rdvPris7j}`,
        `Taux de qualification : ${pct(s.tauxQualification)} · Taux de RDV : ${pct(s.tauxRdv)}`,
        `Coût IA sur 7 jours : ${s.cout7jUsd.toFixed(2)} $`,
      ].join("\n");
      await this.d.notifier.send({ kind: "bilan", title: "Bilan de la semaine du moteur DM", body, link: `${this.d.cfg.PUBLIC_BASE_URL}/cockpit` });
      return;
    }
    const conversationId = p.conversationId ? String(p.conversationId) : null;
    const link = conversationId ? `${this.d.cfg.PUBLIC_BASE_URL}/cockpit/conversations/${conversationId}` : undefined;
    const res = await this.d.notifier.send({
      kind: String(p.kind ?? "info"),
      title: String(p.title ?? "Notification"),
      body: String(p.body ?? ""),
      urgent: p.urgent === true,
      link,
    });
    if (res.failed.length && !res.delivered.length) throw new Error(`Notification non délivrée (${res.failed.join(", ")})`);
  }

  private async jobCommentaire(p: Record<string, unknown>): Promise<void> {
    const { db, studio } = this.d;
    const commentId = String(p.commentId ?? "");
    const text = String(p.text ?? "");
    const mediaId = p.mediaId ? String(p.mediaId) : null;
    if (!commentId || p.parentId) return; // on ne répond pas aux réponses de réponses
    const rules = await listCommentRules(db);
    const rule = matchCommentRule(rules, text, mediaId);
    if (!rule) return;
    const fromUsername = p.fromUsername ? String(p.fromUsername) : null;
    const fromId = p.fromId ? String(p.fromId) : null;
    const claimed = await claimComment(db, { comment_id: commentId, rule_id: rule.id, media_id: mediaId, from_id: fromId, from_username: fromUsername, text });
    if (!claimed) return;
    // Pas de message automatique à une personne désinscrite, ni pendant qu'un humain a repris la main.
    const known = (fromId ? await findContactByExternal(db, "instagram", fromId) : undefined) ?? (fromUsername ? await findContactByUsername(db, fromUsername) : undefined);
    if (known) {
      const open = await this.d.db.one<Conversation>("SELECT * FROM conversations WHERE contact_id = $1 AND status = 'ouverte' LIMIT 1", [known.id]);
      const paused = !!open?.ai_paused_until && new Date(open.ai_paused_until) > this.now();
      if (known.opted_out_at || paused) {
        await markCommentHandled(db, commentId, { error: known.opted_out_at ? "personne désinscrite : aucun message" : "conversation reprise par l'équipe : aucun message automatique" });
        await logEvent(db, "commentaire_ignore", { commentId, raison: known.opted_out_at ? "desinscrit" : "reprise_humaine" }, { contactId: known.id });
        return;
      }
    }
    const dm =
      rule.dm_text ??
      `Hello${fromUsername ? " @" + fromUsername : ""} ! Merci pour ton commentaire 🙌 Moi c'est ${studio.vars.ASSISTANT_NAME}, l'IA de ${studio.vars.STUDIO_NAME}. Tu as un projet d'app en tête ? Raconte-moi en deux mots ce que tu imagines.`;
    try {
      const res = await this.d.messenger.privateReply(commentId, dm);
      await markCommentHandled(db, commentId, { dm_sent: true });
      if (res.recipientId) {
        const { contact } = await upsertContact(db, "instagram", res.recipientId, { username: fromUsername ?? undefined });
        const { conversation } = await getOrCreateConversation(db, contact.id, "instagram", "commentaire", mediaId);
        await insertMessage(db, { conversation_id: conversation.id, direction: "entrant", author: "prospect", kind: "commentaire", text, created_at: new Date(String(p.timestamp ?? this.now().toISOString())) });
        await insertMessage(db, { conversation_id: conversation.id, direction: "sortant", author: "ia", text: dm, external_id: res.messageId, status: "envoye", sent_at: this.now(), created_at: this.now() });
        await touchOutbound(db, conversation.id, this.now());
      }
      await logEvent(db, "commentaire_dm", { commentId, ruleId: rule.id, username: fromUsername });
    } catch (err) {
      await markCommentHandled(db, commentId, { error: errorMessage(err) });
      log.warn("réponse privée au commentaire impossible", { commentId, error: errorMessage(err) });
      return;
    }
    const publicReply = rule.public_reply ?? PUBLIC_REPLIES[Math.floor(this.rng() * PUBLIC_REPLIES.length)]!;
    if (publicReply) {
      try {
        await this.d.messenger.replyToComment(commentId, publicReply);
        await markCommentHandled(db, commentId, { public_replied: true });
      } catch (err) {
        log.warn("réponse publique au commentaire impossible", { error: errorMessage(err) });
      }
    }
  }

  /* =========================== Utilitaires =========================== */

  /** Message direct (hors IA conversationnelle) : désinscription, teaser d'ébauche… */
  private async sendSystemText(conversation: Conversation, contact: Contact, text: string): Promise<void> {
    const { db } = this.d;
    const row = await insertMessage(db, { conversation_id: conversation.id, direction: "sortant", author: "ia", text, status: "planifie", payload: { systeme: true }, created_at: this.now() });
    if (!row || !contact.external_id) return;
    if (conversation.channel !== "bac_a_sable" && !canSendAutomated(conversation.last_inbound_at ?? null, this.now())) {
      await markFailed(db, row.id, "Fenêtre de 24 h fermée");
      return;
    }
    try {
      const res = await this.messengerFor(conversation).sendText(contact.external_id, text);
      await markSent(db, row.id, res.messageId, this.now());
      await touchOutbound(db, conversation.id, this.now());
    } catch (err) {
      await markFailed(db, row.id, errorMessage(err));
    }
  }

  private async notify(conversation: Conversation, contact: Contact, lead: Lead, kind: string, title: string, body: string, urgent = false): Promise<void> {
    const who = lead.fiche.prenom ? `${lead.fiche.prenom} (@${contact.username ?? "?"})` : `@${contact.username ?? contact.name ?? "inconnu"}`;
    await enqueue(
      this.d.db,
      "notifier",
      { kind, title: `${conversation.channel === "bac_a_sable" ? "[Bac à sable] " : ""}${title} — ${who}`, body, urgent, conversationId: conversation.id, contactId: contact.id },
      { runAt: this.now() },
    );
  }

  /**
   * Étape changée à la main (cockpit, MCP). « Désinscrit » coupe vraiment tout message automatique,
   * et une étape terminale (RDV pris, signé, perdu, non qualifié) arrête les relances.
   */
  async setStageManually(contactId: string, stage: Stage, via: "cockpit" | "mcp"): Promise<void> {
    const { db } = this.d;
    await updateLead(db, contactId, { stage, ...(stage === "rdv_pris" ? { next_action: null } : {}), ...(stage === "desinscrit" ? { score: 0, temperature: "froid" as const } : {}) });
    const open = await db.one<Conversation>("SELECT * FROM conversations WHERE contact_id = $1 AND status = 'ouverte' LIMIT 1", [contactId]);
    if (stage === "desinscrit") {
      await optOutContact(db, contactId);
      if (open) {
        await cancelJobs(db, { types: ["repondre", "envoyer", "relancer"], conversationId: open.id });
        await cancelPlannedMessages(db, open.id);
      }
    } else if (TERMINAL_STAGES.has(stage) && open) {
      await cancelJobs(db, { types: ["relancer"], conversationId: open.id });
    }
    await logEvent(db, stage === "gagne" ? "signe" : "etape_manuelle", { etape: stage, via }, { contactId, conversationId: open?.id });
  }

  /** Envoi d'un message écrit par l'équipe depuis le cockpit. */
  async sendHumanMessage(conversationId: string, text: string, author = "équipe"): Promise<{ ok: boolean; error?: string }> {
    const { db, cfg } = this.d;
    const loaded = await this.load(conversationId);
    if (!loaded) return { ok: false, error: "Conversation introuvable" };
    const { conversation, contact } = loaded;
    if (!contact.external_id) return { ok: false, error: "Destinataire inconnu" };
    const now = this.now();
    const inWindow = conversation.channel === "bac_a_sable" || canSendAutomated(conversation.last_inbound_at, now, 0);
    const humanAgentOk = cfg.IG_HUMAN_AGENT_TAG && conversation.last_inbound_at && now.getTime() - new Date(conversation.last_inbound_at).getTime() < 7 * 86_400_000;
    if (!inWindow && !humanAgentOk) {
      return { ok: false, error: "Fenêtre de 24 h fermée : écris depuis l'application Instagram (ou active le tag Human Agent après validation Meta)." };
    }
    const row = await insertMessage(db, { conversation_id: conversationId, direction: "sortant", author: "humain", text, status: "planifie", payload: { auteur: author }, created_at: now });
    if (!row) return { ok: false, error: "Message non enregistré" };
    try {
      const res = await this.messengerFor(conversation).sendText(contact.external_id, text, [], { humanAgent: !inWindow });
      await markSent(db, row.id, res.messageId, now);
      await touchOutbound(db, conversationId, now);
      await pauseAi(db, conversationId, addMs(now, cfg.HUMAN_TAKEOVER_PAUSE_HOURS * 3_600_000));
      await cancelJobs(db, { types: ["repondre", "relancer"], conversationId });
      await logEvent(db, "message_equipe", { author }, { conversationId, contactId: contact.id });
      return { ok: true };
    } catch (err) {
      await markFailed(db, row.id, errorMessage(err));
      return { ok: false, error: errorMessage(err) };
    }
  }
}

export interface SendPayload {
  conversationId: string;
  messageIds: string[];
  plan: DeliveryStep[];
  afterInboundId: string;
  startedAt: string;
}

export interface RelancePayload {
  conversationId: string;
  numero: number;
  total: number;
  afterInboundAt: string;
}

/** Une règle s'applique si un de ses mots-clés apparaît comme mot entier (insensible à la casse et aux accents). */
export function matchCommentRule(rules: CommentRule[], text: string, mediaId: string | null): CommentRule | null {
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toUpperCase();
  const t = ` ${norm(text).replace(/[^A-Z0-9]+/g, " ")} `;
  for (const r of rules) {
    if (!r.active) continue;
    if (r.media_id && r.media_id !== mediaId) continue;
    if (r.keywords.some((k) => t.includes(` ${norm(k).replace(/[^A-Z0-9]+/g, " ").trim()} `))) return r;
  }
  return null;
}
