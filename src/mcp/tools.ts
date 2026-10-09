import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { App } from "../app.js";
import { STAGES, type Stage } from "../domain.js";
import { listConversations, findConversation, pauseAi } from "../db/repo/conversations.js";
import { conversationHistory } from "../db/repo/messages.js";
import { getLead, listLeads, updateLead } from "../db/repo/leads.js";
import { findContact } from "../db/repo/contacts.js";
import { listEvents, listProspects, logEvent, updateProspect, usageSince } from "../db/repo/misc.js";
import { dashboardStats } from "../db/repo/stats.js";
import { newId, sleep } from "../util/index.js";

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });

/**
 * Serveur MCP du moteur DM : permet de piloter le moteur depuis Claude (Claude Code, Claude Desktop,
 * ou tout client MCP) — consulter les leads, lire une conversation, tester l'IA, gérer les prospects.
 */
export function createMcpServer(app: App, opts: { workerRunning: boolean }): McpServer {
  const server = new McpServer({ name: "moteur-dm-yd-studio", version: "0.1.0" });
  const { db } = app;

  server.registerTool(
    "leads_chauds",
    { description: "Liste les prospects les plus avancés (budget validé, ébauche, rendez-vous), avec leur projet et la prochaine action.", inputSchema: { limite: z.number().int().min(1).max(50).optional() } },
    async ({ limite }) => {
      const leads = await listLeads(db, { stages: ["qualifie", "ebauche", "rdv_propose", "rdv_pris"], limit: limite ?? 15 });
      return text(leads.map((l) => ({ conversation_id: l.conversation_id, contact_id: l.contact_id, instagram: l.username, prenom: l.fiche.prenom, projet: l.fiche.projet, etape: l.stage, score: l.score, budget: l.fiche.budget_declare ?? l.fiche.budget_estime_eur, prochaine_action: l.next_action, rdv: l.rdv_note })));
    },
  );

  server.registerTool(
    "rechercher_conversations",
    { description: "Recherche des conversations par @, prénom ou projet, et/ou par étape du pipeline.", inputSchema: { recherche: z.string().optional(), etape: z.enum(STAGES).optional(), limite: z.number().int().min(1).max(100).optional() } },
    async ({ recherche, etape, limite }) => {
      const items = await listConversations(db, { search: recherche, stage: etape, limit: limite ?? 20 });
      return text(items.map((c) => ({ conversation_id: c.id, instagram: c.username, etape: c.stage, score: c.score, dernier_message: c.last_text, auteur: c.last_author, date: c.last_at })));
    },
  );

  server.registerTool(
    "lire_conversation",
    { description: "Renvoie la transcription complète d'une conversation, la fiche du prospect et les événements récents.", inputSchema: { conversation_id: z.string() } },
    async ({ conversation_id }) => {
      const conv = await findConversation(db, conversation_id);
      if (!conv) return text("Conversation introuvable.");
      const contact = await findContact(db, conv.contact_id);
      const lead = await getLead(db, conv.contact_id);
      const messages = await conversationHistory(db, conversation_id, 200);
      const events = await listEvents(db, { contactId: conv.contact_id, limit: 30 });
      return text({
        prospect: { instagram: contact?.username, nom: contact?.name, abonnes: contact?.follower_count, desinscrit: !!contact?.opted_out_at },
        etape: lead.stage,
        score: lead.score,
        budget: lead.budget_status,
        fiche: lead.fiche,
        resume: lead.summary,
        prochaine_action: lead.next_action,
        ia_en_pause: !!(conv.ai_paused_until && new Date(conv.ai_paused_until) > app.clock.now()),
        messages: messages.map((m) => ({ de: m.direction === "entrant" ? "prospect" : m.author, texte: m.text, date: m.created_at, statut: m.status })),
        evenements: events.map((e) => ({ type: e.type, date: e.created_at, data: e.data })),
      });
    },
  );

  server.registerTool(
    "statistiques",
    { description: "Indicateurs des 7 derniers jours (conversations, budgets validés, ébauches, rendez-vous, coût IA) et coûts par usage sur 30 jours." },
    async () => {
      const now = app.clock.now();
      return text({ semaine: await dashboardStats(db, now), couts_30_jours: await usageSince(db, new Date(now.getTime() - 30 * 86_400_000)) });
    },
  );

  server.registerTool(
    "prospects_a_contacter",
    { description: "Liste les prospects repérés, triés par score, avec l'accroche rédigée par l'IA à envoyer à la main.", inputSchema: { statut: z.enum(["a_contacter", "contacte", "a_repondu", "a_qualifier", "ecarte"]).optional() } },
    async ({ statut }) => {
      const list = await listProspects(db, { status: [statut ?? "a_contacter"], limit: 50 });
      return text(list.map((p) => ({ prospect_id: p.id, nom: p.company_name ?? p.person_name, instagram: p.instagram, score: p.score, raison: p.score_reason, accroche: p.opener, source: p.source })));
    },
  );

  server.registerTool(
    "ajouter_prospect",
    { description: "Ajoute un prospect repéré par l'équipe ; l'IA calcule son score et rédige l'accroche.", inputSchema: { instagram: z.string().optional(), entreprise: z.string().optional(), personne: z.string().optional(), notes: z.string().optional() } },
    async (a) => {
      const p = await app.prospects.addManual({ instagram: a.instagram, company: a.entreprise, person: a.personne, notes: a.notes });
      return text(p ? { prospect_id: p.id, score: p.score, raison: p.score_reason, accroche: p.opener, statut: p.status } : "Ce prospect existe déjà.");
    },
  );

  server.registerTool(
    "marquer_prospect",
    { description: "Met à jour un prospect : message envoyé (contacte) ou écarté ; permet aussi d'enregistrer son @ Instagram pour reconnaître sa réponse.", inputSchema: { prospect_id: z.string(), statut: z.enum(["contacte", "ecarte"]), instagram: z.string().optional() } },
    async ({ prospect_id, statut, instagram }) => {
      await updateProspect(db, prospect_id, { status: statut, instagram, contacted: statut === "contacte" });
      return text("Prospect mis à jour.");
    },
  );

  server.registerTool(
    "changer_etape",
    { description: "Change l'étape d'un lead dans le pipeline (par exemple « gagne » quand le contrat est signé, « rdv_pris » quand l'appel est confirmé, ce qui arrête les relances). « desinscrit » coupe tout message automatique.", inputSchema: { contact_id: z.string(), etape: z.enum(STAGES) } },
    async ({ contact_id, etape }) => {
      await app.engine.setStageManually(contact_id, etape as Stage, "mcp");
      return text(`Étape mise à jour : ${etape}.`);
    },
  );

  server.registerTool(
    "pause_ia",
    { description: "Met l'IA en pause sur une conversation (l'équipe répond) ou lui rend la main.", inputSchema: { conversation_id: z.string(), pause: z.boolean() } },
    async ({ conversation_id, pause }) => {
      await pauseAi(db, conversation_id, pause ? new Date(app.clock.now().getTime() + 30 * 86_400_000) : null);
      return text(pause ? "IA en pause sur cette conversation." : "L'IA a repris la main.");
    },
  );

  server.registerTool(
    "envoyer_message_equipe",
    {
      description: "Envoie sur Instagram un message écrit par l'équipe dans une conversation (uniquement dans la fenêtre de 24 h). L'IA se met en pause sur cette conversation. Action réelle : le prospect reçoit le message.",
      inputSchema: { conversation_id: z.string(), texte: z.string().min(1).max(1000) },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    async ({ conversation_id, texte }) => text(await app.engine.sendHumanMessage(conversation_id, texte, "mcp")),
  );

  server.registerTool(
    "tester_ia",
    {
      description: "Envoie un message à l'IA comme le ferait un prospect, dans le bac à sable (rien ne part sur Instagram), et renvoie sa réponse et la fiche mise à jour. Réutiliser le même `session` pour continuer la conversation.",
      inputSchema: { message: z.string().min(1), session: z.string().optional() },
    },
    async ({ message, session }) => {
      const sid = session ?? `mcp-${newId()}`;
      const r = await app.engine.onInbound({ channel: "bac_a_sable", externalUserId: sid, mid: null, text: message, kind: "texte", payload: {}, source: "bac_a_sable", at: app.clock.now() });
      if (!r) return text("Message non enregistré.");
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        if (!opts.workerRunning) await app.worker.drain(20);
        const pending = await db.one<{ n: number }>(
          "SELECT count(*)::int AS n FROM jobs WHERE status IN ('en_attente','en_cours') AND type IN ('repondre','envoyer') AND payload->>'conversationId' = $1",
          [r.conversationId],
        );
        if (!pending?.n) break;
        await sleep(800);
      }
      const history = await conversationHistory(db, r.conversationId, 100);
      const idx = history.findIndex((m) => m.id === r.messageId);
      const replies = history.slice(idx + 1).filter((m) => m.direction === "sortant").map((m) => m.text);
      const conv = await findConversation(db, r.conversationId);
      const lead = conv ? await getLead(db, conv.contact_id) : null;
      return text({ session: sid, reponses: replies, etape: lead?.stage, budget: lead?.budget_status, score: lead?.score, fiche: lead?.fiche });
    },
  );

  server.registerTool(
    "relances_manuelles",
    { description: "Liste les conversations arrêtées dont la fenêtre de 24 h est fermée, avec le message de relance prêt à envoyer à la main depuis Instagram." },
    async () => {
      const leads = await listLeads(db, { stages: ["decouverte", "qualification", "qualifie", "ebauche", "rdv_propose"], limit: 50 });
      const now = app.clock.now().getTime();
      return text(
        leads
          .filter((l) => l.manual_followup && l.last_inbound_at && now - new Date(l.last_inbound_at).getTime() > 24 * 3_600_000)
          .map((l) => ({ conversation_id: l.conversation_id, instagram: l.username, prenom: l.fiche.prenom, projet: l.fiche.projet, message: l.manual_followup, lien_dm: l.username ? `https://ig.me/m/${l.username}` : null })),
      );
    },
  );

  return server;
}
