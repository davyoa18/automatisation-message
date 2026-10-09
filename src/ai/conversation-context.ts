/**
 * Ce que l'IA conversationnelle reçoit et ce qu'on fait de sa réponse, sans base de données ni
 * appel réseau : partagé par le moteur (src/ai/agent.ts) et par le Labo (labo/), pour que le
 * Labo se comporte exactement comme la production.
 */
import { STAGE_LABELS, type Contact, type Conversation, type Ebauche, type Lead, type Message } from "../domain.js";
import { formatParis, truncateBytes } from "../util/pure.js";

export const REPLY_SCHEMA = {
  type: "object",
  properties: {
    messages: { type: "array", items: { type: "string" }, description: "Bulles à envoyer, dans l'ordre (0 à 3)" },
    boutons: { type: "array", items: { type: "string" }, description: "0 à 3 réponses rapides de 20 caractères maximum" },
    relance_utile: { type: "boolean" },
    note_equipe: { type: "string" },
  },
  required: ["messages", "boutons", "relance_utile", "note_equipe"],
  additionalProperties: false,
} as const;

export const SOURCE_LABELS: Record<string, string> = {
  dm: "message privé direct",
  commentaire: "commentaire sous un post (message privé envoyé en réponse)",
  story: "réponse à une story",
  mention: "mention dans une story",
  pub: "publicité Instagram « Envoyer un message »",
  sortant: "réponse à un premier message envoyé par l'équipe",
  ice_breaker: "question d'accueil Instagram",
  bac_a_sable: "test interne dans le cockpit (bac à sable)",
};

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

export type HistoryMessage = Pick<Message, "direction" | "author" | "kind" | "text" | "payload">;

/** Transforme l'historique stocké en tours user/assistant lisibles par le modèle. */
export function historyToTurns(history: HistoryMessage[], conversation: Pick<Conversation, "source">): Turn[] {
  const turns: { role: "user" | "assistant"; text: string }[] = [];
  for (const m of history) {
    let text = (m.text ?? "").trim();
    const p = m.payload ?? {};
    if (m.direction === "entrant") {
      if (m.kind === "story_reply") text = `[Réponse à ta story] ${text}`.trim();
      else if (m.kind === "story_mention") text = `[Cette personne t'a mentionné dans sa story] ${text}`.trim();
      else if (m.kind === "postback") text = `[A touché le bouton « ${String(p.title ?? text)} »]`;
      else if (m.kind === "commentaire") text = `[Commentaire public sous un post du studio : « ${text} »]`;
      else if (m.kind === "image" || m.kind === "pieces") text = `[Pièce jointe : ${String(p.attachmentType ?? "fichier")}] ${text}`.trim();
      if (p.adTitle) text = `[Arrivé via la publicité « ${String(p.adTitle)} »] ${text}`;
      if (!text) continue;
      turns.push({ role: "user", text });
    } else {
      if (!text) continue;
      if (m.author === "humain") text = `[Équipe] ${text}`;
      turns.push({ role: "assistant", text });
    }
  }
  // Fusion des tours consécutifs du même rôle.
  const merged: { role: "user" | "assistant"; text: string }[] = [];
  for (const t of turns) {
    const last = merged[merged.length - 1];
    if (last && last.role === t.role) last.text += `\n${t.text}`;
    else merged.push({ ...t });
  }
  if (merged[0]?.role === "assistant") {
    merged.unshift({ role: "user", text: `[Début de la conversation : ${SOURCE_LABELS[conversation.source] ?? conversation.source}]` });
  }
  return merged.map((t) => ({ role: t.role, content: t.text }));
}

export function describeEbauche(e: Pick<Ebauche, "status"> | null): string {
  if (!e) return "aucune";
  if (e.status === "prete") return "prête (l'équipe la montrera pendant l'appel)";
  if (e.status === "echec") return "échec de génération (l'équipe la prépare à la main)";
  return "en préparation";
}

export interface ContextInput {
  conversation: Pick<Conversation, "source" | "source_ref" | "channel">;
  contact: Pick<Contact, "username" | "name" | "follower_count" | "is_verified" | "follows_us">;
  lead: Pick<Lead, "stage" | "budget_status" | "score" | "fiche" | "rdv_at" | "rdv_note" | "summary" | "next_action">;
  ebauche: Pick<Ebauche, "status"> | null;
}

export interface ContextOptions {
  now: Date;
  timezone: string;
  bookingUrl: string;
}

/** Le contexte dynamique (invisible pour le prospect) ajouté à chaque réponse. */
export function buildContext(input: ContextInput, opts: ContextOptions, isFirstAiMessage: boolean): string {
  const { contact, lead, conversation, ebauche } = input;
  const profil = [
    contact.username ? `@${contact.username}` : null,
    contact.name,
    contact.follower_count != null ? `${contact.follower_count} abonnés` : null,
    contact.is_verified ? "compte vérifié" : null,
    contact.follows_us === true ? "suit le studio" : contact.follows_us === false ? "ne suit pas le studio" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const rdv = lead.rdv_at
    ? `demandé pour ${formatParis(new Date(lead.rdv_at), opts.timezone)} (${lead.rdv_note ?? ""})`
    : lead.rdv_note ?? (lead.stage === "rdv_propose" ? "proposé, pas encore choisi" : "aucun");
  const lines = [
    "# Contexte de ta réponse (invisible pour le prospect)",
    `- Maintenant : ${formatParis(opts.now, opts.timezone)} (heure de Paris).`,
    `- Arrivée de la conversation : ${SOURCE_LABELS[conversation.source] ?? conversation.source}${conversation.source_ref ? ` (${conversation.source_ref})` : ""}.`,
    isFirstAiMessage
      ? "- C'est ton premier message dans cette conversation : présente-toi comme l'IA du studio (règle 1)."
      : "- Tu t'es déjà présentée : ne te représente pas.",
    profil ? `- Profil Instagram : ${profil}.` : null,
    `- Étape : ${STAGE_LABELS[lead.stage]} · Budget : ${lead.budget_status} · Score : ${lead.score}/100.`,
    `- Fiche actuelle : ${JSON.stringify(lead.fiche)}`,
    `- Ébauche : ${describeEbauche(ebauche)}.`,
    `- Rendez-vous : ${rdv}.`,
    `- Lien de réservation : ${opts.bookingUrl ? "disponible via proposer_rdv" : "non configuré (propose des créneaux)"}.`,
    lead.summary ? `- Résumé des échanges précédents : ${lead.summary}` : null,
    lead.next_action ? `- Note de l'équipe : ${lead.next_action}` : null,
    conversation.channel === "bac_a_sable" ? "- Conversation de test interne : comporte-toi exactement comme avec un vrai prospect." : null,
  ];
  return lines.filter(Boolean).join("\n");
}

/**
 * Le message mentionne-t-il que c'est une IA ? Sigles en majuscules seulement : en minuscules,
 * « ai » apparaît dans « j'ai » et ferait croire à tort que la présentation a été faite.
 */
export function hasDisclosure(text: string): boolean {
  return /\b(?:IA|I\.A\.|AI)\b/.test(text) || /intelligence artificielle|assistante? virtuel(?:le)?/i.test(text);
}

/** Nettoie les bulles : pas de markdown, taille compatible Instagram, 3 bulles au plus. */
export function sanitizeMessages(messages: string[]): string[] {
  return messages
    .map((m) =>
      m
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/__(.+?)__/g, "$1")
        .replace(/^#+\s*/gm, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
    )
    .filter(Boolean)
    .slice(0, 3)
    .map((m) => truncateBytes(m, 990));
}

export function sanitizeButtons(buttons: string[]): string[] {
  return buttons
    .map((b) => b.trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((b) => (b.length > 20 ? b.slice(0, 19) + "…" : b));
}

/** Obligation de transparence : si le modèle a oublié de se présenter comme une IA, on l'ajoute. */
export function ensureDisclosure(messages: string[], isFirstAiMessage: boolean, vars: Record<string, string | undefined>): string[] {
  if (!isFirstAiMessage || !messages.length || messages.some(hasDisclosure)) return messages;
  const studio = vars.STUDIO_NAME ? `de ${vars.STUDIO_NAME}` : "du studio";
  const intro = `Moi c'est ${vars.ASSISTANT_NAME ?? "Nova"}, l'IA ${studio}. L'équipe suit nos échanges.`;
  // Trois bulles au plus : au-delà, la présentation rejoint la première bulle au lieu d'en chasser une.
  if (messages.length < 3) return [intro, ...messages];
  return [truncateBytes(`${intro} ${messages[0]}`, 990), ...messages.slice(1)];
}

/** Réponse de repli quand le modèle refuse ou renvoie une réponse illisible : un humain prend le relais. */
export const FALLBACK_REPLY = "Je laisse quelqu'un de l'équipe te répondre sur ce point, il revient vers toi très vite.";

/* ------------------------- Appels « hors conversation » ------------------------- */

export type TranscriptMessage = Pick<Message, "direction" | "author" | "text" | "status"> & { created_at: Date | string | number };

/** Transcription lisible d'une conversation (relances, analyse). */
export function transcriptOf(history: TranscriptMessage[], assistantName: string, tz = "Europe/Paris"): string {
  return history
    .filter((m) => m.status !== "annule" && (m.text ?? "").trim())
    .map((m) => {
      const who = m.direction === "entrant" ? "Prospect" : m.author === "humain" ? "Équipe" : m.author === "ia" ? assistantName : "Système";
      const when = formatParis(new Date(m.created_at), tz);
      return `[${when}] ${who} : ${(m.text ?? "").trim()}`;
    })
    .join("\n");
}

export function leadBlock(lead: Pick<Lead, "stage" | "budget_status" | "score" | "fiche" | "summary">, contact: Pick<Contact, "username" | "name">): string {
  return [
    `Étape : ${lead.stage} · Budget : ${lead.budget_status} · Score : ${lead.score}/100`,
    `Profil : ${contact.username ? "@" + contact.username : "?"}${contact.name ? " · " + contact.name : ""}`,
    `Fiche : ${JSON.stringify(lead.fiche)}`,
    lead.summary ? `Résumé : ${lead.summary}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export interface FollowupInput {
  lead: Pick<Lead, "stage" | "budget_status" | "score" | "fiche" | "summary">;
  contact: Pick<Contact, "username" | "name">;
  history: TranscriptMessage[];
  assistantName: string;
  timezone: string;
}

/** Le message envoyé au modèle pour rédiger une relance (prompt « relance »). */
export function relanceRequest(args: FollowupInput & { numero: number; total: number; now: Date }): string {
  return [
    `Relance n°${args.numero} sur ${args.total}${args.numero === args.total ? " (la dernière)" : ""}.`,
    `Maintenant : ${formatParis(args.now, args.timezone)}.`,
    "",
    "## Fiche",
    leadBlock(args.lead, args.contact),
    "",
    "## Conversation",
    transcriptOf(args.history, args.assistantName, args.timezone),
  ].join("\n");
}

/** Le message envoyé au modèle pour analyser une conversation (prompt « analyse »). */
export function analyseRequest(args: FollowupInput): string {
  return ["## Fiche", leadBlock(args.lead, args.contact), "", "## Conversation", transcriptOf(args.history, args.assistantName, args.timezone)].join("\n");
}
