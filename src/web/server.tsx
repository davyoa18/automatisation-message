import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { App } from "../app.js";
import { productionGaps } from "../config.js";
import { STAGES, type Stage } from "../domain.js";
import { parseWebhook, verifySignature } from "../instagram/webhook.js";
import { listConversations, findConversation, pauseAi } from "../db/repo/conversations.js";
import { conversationHistory } from "../db/repo/messages.js";
import { getLead, listLeads, updateLead } from "../db/repo/leads.js";
import { findContact, findContactByExternal, eraseContact } from "../db/repo/contacts.js";
import {
  addFeedback,
  deleteCommentRule,
  getEbauche,
  getMedia,
  listCommentRules,
  listEbauches,
  listEvents,
  listProspects,
  logEvent,
  updateProspect,
  upsertCommentRule,
  usageSince,
} from "../db/repo/misc.js";
import { dashboardStats } from "../db/repo/stats.js";
import { latestConversationForContact } from "../db/repo/conversations.js";
import { canSendAutomated, windowClosesAt } from "../engine/window.js";
import { cockpitAuth } from "./auth.js";
import { Layout } from "./ui.js";
import { ConversationPage, ConversationsPage, DashboardPage, EbauchePage, EbauchesPage, LoginPage, ProspectsPage, SandboxPage, SettingsPage } from "./pages.js";
import { createMcpServer } from "../mcp/tools.js";
import { log } from "../logger.js";
import { newId, safeEqual } from "../util/index.js";

export function createServer(app: App, opts: { workerRunning: boolean }): Hono {
  const { db, cfg } = app;
  const web = new Hono();
  const auth = cockpitAuth(cfg);
  const studioName = app.studio.vars.STUDIO_NAME!;
  const mode = app.graph ? "Instagram connecté" : cfg.DRY_RUN ? "Mode à blanc (DRY_RUN)" : "Instagram non connecté";
  const page = (path: string, title: string, body: unknown, scripts?: string) => (
    <Layout title={title} path={path} studio={studioName} mode={mode} scripts={scripts}>
      {body as never}
    </Layout>
  );

  web.get("/", (c) => c.redirect("/cockpit"));
  web.get("/favicon.ico", (c) =>
    c.body(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0f766e"/><path d="M9 11h14v9H15l-4 3v-3H9z" fill="#fff"/></svg>`, 200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" }),
  );
  web.get("/health", async (c) => {
    let dbOk = true;
    try {
      await db.query("SELECT 1");
    } catch {
      dbOk = false;
    }
    return c.json({ ok: dbOk, db: db.kind, instagram: app.messenger.mode, ia: !!app.llm, version: "0.1.0" }, dbOk ? 200 : 503);
  });

  /* ------------------------------ Webhooks Meta ------------------------------ */

  web.get("/webhooks/instagram", (c) => {
    const mode = c.req.query("hub.mode");
    const token = c.req.query("hub.verify_token");
    const challenge = c.req.query("hub.challenge");
    if (mode === "subscribe" && cfg.IG_VERIFY_TOKEN && token && safeEqual(token, cfg.IG_VERIFY_TOKEN)) return c.text(challenge ?? "");
    return c.text("Jeton de vérification invalide", 403);
  });

  web.post("/webhooks/instagram", async (c) => {
    const raw = await c.req.text();
    const signed = verifySignature(raw, c.req.header("x-hub-signature-256"), cfg.IG_APP_SECRET);
    if (!signed && !(cfg.NODE_ENV !== "production" && !cfg.IG_APP_SECRET)) {
      log.warn("webhook refusé : signature invalide");
      return c.text("Signature invalide", 401);
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return c.text("JSON invalide", 400);
    }
    const events = parseWebhook(body);
    // Meta attend une réponse rapide : le traitement lourd (IA, envoi) passe par la file de tâches.
    // En cas d'échec, une erreur 500 fait renvoyer le webhook par Meta (les doublons sont écartés).
    const { failed } = await app.engine.handleEvents(events);
    if (failed) return c.text("Traitement incomplet, merci de renvoyer", 500);
    return c.text("EVENT_RECEIVED");
  });

  /* ------------------------------ Médias publics (URL non devinables) ------------------------------ */

  web.get("/media/:id", async (c) => {
    const m = await getMedia(db, c.req.param("id"));
    if (!m) return c.notFound();
    return new Response(new Uint8Array(m.bytes), { headers: { "Content-Type": m.content_type, "Cache-Control": "public, max-age=31536000, immutable" } });
  });

  /* ------------------------------ MCP (HTTP) ------------------------------ */

  web.all("/mcp", async (c) => {
    const header = c.req.header("authorization") ?? "";
    if (!cfg.MCP_TOKEN || !safeEqual(header, `Bearer ${cfg.MCP_TOKEN}`)) return c.json({ error: "MCP_TOKEN manquant ou invalide" }, 401);
    const server = createMcpServer(app, opts);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  /* ------------------------------ Cockpit ------------------------------ */

  web.get("/cockpit/connexion", (c) => c.html(<LoginPage studio={studioName} retour={c.req.query("retour")} />));
  web.post("/cockpit/connexion", async (c) => {
    const form = await c.req.parseBody();
    const ok = auth.login(c, String(form.motdepasse ?? ""));
    if (!ok) return c.html(<LoginPage studio={studioName} error="Mot de passe incorrect." retour={String(form.retour ?? "/cockpit")} />, 401);
    const retour = String(form.retour ?? "/cockpit");
    return c.redirect(retour.startsWith("/cockpit") ? retour : "/cockpit");
  });
  web.post("/cockpit/deconnexion", (c) => {
    auth.logout(c);
    return c.redirect("/cockpit/connexion");
  });

  web.use("/cockpit/*", auth.middleware);
  web.use("/cockpit", auth.middleware);

  web.get("/cockpit", async (c) => {
    const now = app.clock.now();
    const [stats, hot, active] = await Promise.all([
      dashboardStats(db, now),
      listLeads(db, { stages: ["qualifie", "ebauche", "rdv_propose", "rdv_pris"], limit: 10 }),
      listLeads(db, { stages: ["decouverte", "qualification", "qualifie", "ebauche", "rdv_propose", "rdv_pris", "desinscrit"], limit: 100 }),
    ]);
    const todo = active.filter((l) => l.next_action && /^(Confirmer|Répondre|Effacer)/.test(l.next_action)).slice(0, 10);
    const manual = active
      .filter((l) => l.manual_followup && !canSendAutomated(l.last_inbound_at, now, 0) && l.stage !== "desinscrit" && l.stage !== "rdv_pris")
      .slice(0, 10)
      .map((l) => ({ ...l, window_open: false }));
    return c.html(page("/cockpit", "Tableau de bord", <DashboardPage stats={stats} hot={hot.filter((h) => h.username || h.fiche.prenom)} todo={todo} manual={manual} gaps={productionGaps(cfg)} now={now} />));
  });

  web.get("/cockpit/conversations", async (c) => {
    const stage = c.req.query("etape");
    const q = c.req.query("q");
    const items = await listConversations(db, { stage: STAGES.includes(stage as Stage) ? stage : undefined, search: q || undefined, limit: 200 });
    return c.html(page("/cockpit/conversations", "Conversations", <ConversationsPage items={items} stage={stage} q={q} now={app.clock.now()} />));
  });

  web.get("/cockpit/conversations/:id", async (c) => {
    const conversation = await findConversation(db, c.req.param("id"));
    if (!conversation) return c.notFound();
    const contact = await findContact(db, conversation.contact_id);
    if (!contact) return c.notFound();
    const [lead, messages, events] = await Promise.all([
      getLead(db, contact.id),
      conversationHistory(db, conversation.id, 300),
      listEvents(db, { contactId: contact.id, limit: 40 }),
    ]);
    const ebauche = lead.ebauche_id ? ((await getEbauche(db, lead.ebauche_id)) ?? null) : null;
    const fb = await db.query<{ message_id: string }>("SELECT DISTINCT message_id FROM feedback WHERE conversation_id = $1", [conversation.id]);
    const now = app.clock.now();
    return c.html(
      page(
        "/cockpit/conversations",
        contact.username ?? "Conversation",
        <ConversationPage
          conversation={conversation}
          contact={contact}
          lead={lead}
          messages={messages}
          events={events}
          ebauche={ebauche}
          windowOpen={conversation.channel === "bac_a_sable" || canSendAutomated(conversation.last_inbound_at, now, 0)}
          windowCloses={windowClosesAt(conversation.last_inbound_at)}
          paused={!!(conversation.ai_paused_until && new Date(conversation.ai_paused_until) > now)}
          feedback={new Set(fb.map((f) => f.message_id))}
          now={now}
          tz={cfg.TIMEZONE}
          humanAgentTag={cfg.IG_HUMAN_AGENT_TAG}
        />,
      ),
    );
  });

  web.post("/cockpit/conversations/:id/message", async (c) => {
    const form = await c.req.parseBody();
    const res = await app.engine.sendHumanMessage(c.req.param("id"), String(form.texte ?? "").trim());
    if (!res.ok) return c.html(page("/cockpit/conversations", "Erreur", <div class="banner">Message non envoyé : {res.error} <a href={`/cockpit/conversations/${c.req.param("id")}`}>Retour</a></div>), 400);
    return c.redirect(`/cockpit/conversations/${c.req.param("id")}`);
  });

  web.post("/cockpit/conversations/:id/pause", async (c) => {
    await pauseAi(db, c.req.param("id"), new Date(app.clock.now().getTime() + 30 * 86_400_000));
    await logEvent(db, "pause_manuelle", {}, { conversationId: c.req.param("id") });
    return c.redirect(`/cockpit/conversations/${c.req.param("id")}`);
  });
  web.post("/cockpit/conversations/:id/reprendre", async (c) => {
    await pauseAi(db, c.req.param("id"), null);
    await logEvent(db, "reprise_ia", {}, { conversationId: c.req.param("id") });
    return c.redirect(`/cockpit/conversations/${c.req.param("id")}`);
  });

  web.post("/cockpit/leads/:contactId/etape", async (c) => {
    const form = await c.req.parseBody();
    const stage = String(form.etape ?? "");
    const contactId = c.req.param("contactId");
    if (STAGES.includes(stage as Stage)) await app.engine.setStageManually(contactId, stage as Stage, "cockpit");
    const conv = await latestConversationForContact(db, contactId);
    return c.redirect(conv ? `/cockpit/conversations/${conv.id}` : "/cockpit/conversations");
  });

  web.post("/cockpit/leads/:contactId/effacer", async (c) => {
    await eraseContact(db, c.req.param("contactId"));
    await logEvent(db, "effacement_rgpd", {});
    return c.redirect("/cockpit/conversations");
  });

  web.post("/cockpit/messages/:id/avis", async (c) => {
    const form = await c.req.parseBody();
    const msg = await db.one<{ conversation_id: string }>("SELECT conversation_id FROM messages WHERE id = $1", [c.req.param("id")]);
    if (!msg) return c.notFound();
    await addFeedback(db, { message_id: c.req.param("id"), conversation_id: msg.conversation_id, rating: Number(form.note) > 0 ? 1 : -1, comment: form.commentaire ? String(form.commentaire) : null, author: "cockpit" });
    return c.redirect(`/cockpit/conversations/${msg.conversation_id}`);
  });

  /* Prospects */

  web.get("/cockpit/prospects", async (c) => {
    const filter = c.req.query("statut") ?? "a_contacter";
    const valid = ["a_contacter", "contacte", "a_repondu", "a_qualifier", "ecarte"] as const;
    const f = (valid as readonly string[]).includes(filter) ? (filter as (typeof valid)[number]) : "a_contacter";
    const prospects = await listProspects(db, { status: [f], limit: 100 });
    const counts = Object.fromEntries((await db.query<{ status: string; n: number }>("SELECT status, count(*)::int AS n FROM prospects GROUP BY status")).map((r) => [r.status, r.n]));
    return c.html(page("/cockpit/prospects", "Prospects", <ProspectsPage prospects={prospects} filter={f} counts={counts} aiReady={!!app.llm} />));
  });

  web.post("/cockpit/prospects", async (c) => {
    const form = await c.req.parseBody();
    try {
      await app.prospects.addManual({
        instagram: form.instagram ? String(form.instagram) : undefined,
        company: form.entreprise ? String(form.entreprise) : undefined,
        person: form.personne ? String(form.personne) : undefined,
        notes: form.notes ? String(form.notes) : undefined,
      });
    } catch (err) {
      return c.html(page("/cockpit/prospects", "Erreur", <div class="banner">{(err as Error).message} <a href="/cockpit/prospects">Retour</a></div>), 400);
    }
    return c.redirect("/cockpit/prospects?statut=a_contacter");
  });

  web.post("/cockpit/prospects/scan", async (c) => {
    const res = await app.prospects.scan();
    await logEvent(db, "scan_manuel", res);
    return c.redirect("/cockpit/prospects?statut=a_contacter");
  });

  web.post("/cockpit/prospects/:id", async (c) => {
    const form = await c.req.parseBody();
    const statut = String(form.statut ?? "");
    await updateProspect(db, c.req.param("id"), {
      status: statut === "contacte" || statut === "ecarte" ? statut : undefined,
      instagram: form.instagram ? String(form.instagram) : undefined,
      contacted: statut === "contacte",
    });
    return c.redirect(`/cockpit/prospects?statut=${statut === "ecarte" ? "a_contacter" : "contacte"}`);
  });

  /* Ébauches */

  web.get("/cockpit/ebauches", async (c) => c.html(page("/cockpit/ebauches", "Ébauches", <EbauchesPage items={await listEbauches(db)} />)));
  web.get("/cockpit/ebauches/:id", async (c) => {
    const e = await getEbauche(db, c.req.param("id"));
    if (!e) return c.notFound();
    const contact = e.contact_id ? await findContact(db, e.contact_id) : undefined;
    return c.html(page("/cockpit/ebauches", e.brief?.nom_app ?? "Ébauche", <EbauchePage e={e} contact={contact} conversationId={e.conversation_id} />));
  });

  /* Bac à sable */

  web.get("/cockpit/bac-a-sable", (c) => {
    let sid = getCookie(c, "yd_sandbox");
    if (!sid || c.req.query("nouveau")) {
      sid = `bac-${newId()}`;
      setCookie(c, "yd_sandbox", sid, { path: "/cockpit", httpOnly: true, sameSite: "Lax", maxAge: 7 * 86_400 });
    }
    return c.html(page("/cockpit/bac-a-sable", "Bac à sable", <SandboxPage sid={sid} aiReady={!!app.llm} />));
  });

  web.post("/cockpit/bac-a-sable/:sid/message", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { text?: string };
    const text = String(body.text ?? "").trim().slice(0, 2000);
    if (!text) return c.json({ ok: false }, 400);
    await app.engine.onInbound({ channel: "bac_a_sable", externalUserId: c.req.param("sid"), mid: null, text, kind: "texte", payload: {}, source: "bac_a_sable", at: app.clock.now(), username: "bac.a.sable" });
    return c.json({ ok: true });
  });

  web.get("/cockpit/bac-a-sable/:sid/etat", async (c) => {
    const contact = await findContactByExternal(db, "bac_a_sable", c.req.param("sid"));
    if (!contact) return c.json({ messages: [], lead: null, typing: false });
    const conv = await latestConversationForContact(db, contact.id);
    const messages = conv ? await conversationHistory(db, conv.id, 200) : [];
    const lead = await getLead(db, contact.id);
    const pending = conv
      ? await db.one<{ n: number }>("SELECT count(*)::int AS n FROM jobs WHERE status IN ('en_attente','en_cours') AND type IN ('repondre','envoyer') AND payload->>'conversationId' = $1", [conv.id])
      : { n: 0 };
    return c.json({
      typing: (pending?.n ?? 0) > 0,
      messages: messages
        .filter((m) => m.direction === "entrant" || m.status === "envoye")
        .map((m) => ({ direction: m.direction, text: m.text, boutons: Array.isArray(m.payload?.boutons) ? m.payload.boutons : [] })),
      lead: { etape: lead.stage, budget: lead.budget_status, score: lead.score, temperature: lead.temperature, fiche: lead.fiche, ebauche: lead.ebauche_id ? `/cockpit/ebauches/${lead.ebauche_id}` : null },
    });
  });

  /* Réglages */

  web.get("/cockpit/reglages", async (c) => {
    const now = app.clock.now();
    const rows: [string, string][] = [
      ["Instagram", mode],
      ["IA conversation", `${cfg.AI_MODEL_CONVERSATION} (effort ${cfg.AI_EFFORT_CONVERSATION})`],
      ["IA ébauches", cfg.AI_MODEL_EBAUCHE],
      ["IA analyses et prospection", `${cfg.AI_MODEL_ANALYSE} / ${cfg.AI_MODEL_PROSPECTION}`],
      ["Rythme d'envoi", `${cfg.PACING_PROFILE}, regroupement ${cfg.REPLY_DEBOUNCE_SECONDS} s`],
      ["Relances (dans les 24 h)", cfg.RELANCES.join(", ") || "aucune"],
      ["Pause après reprise humaine", `${cfg.HUMAN_TAKEOVER_PAUSE_HOURS} h`],
      ["Lien de réservation", cfg.BOOKING_URL ?? "non configuré"],
      ["Ébauches", cfg.EBAUCHE_ENABLED ? `activées (aperçu envoyé : ${cfg.EBAUCHE_TEASER})` : "désactivées"],
      ["Notifications", [cfg.TELEGRAM_BOT_TOKEN ? "Telegram" : null, cfg.RESEND_API_KEY ? "email" : null, cfg.NOTIFY_WEBHOOK_URL ? "webhook" : null].filter(Boolean).join(", ") || "aucune"],
      ["Base de données", db.kind === "pg" ? "Postgres" : "PGlite (locale)"],
      ["Tag Human Agent", cfg.IG_HUMAN_AGENT_TAG ? "activé" : "désactivé"],
    ];
    return c.html(
      page(
        "/cockpit/reglages",
        "Réglages",
        <SettingsPage gaps={productionGaps(cfg)} rows={rows} rules={await listCommentRules(db, false)} usage={await usageSince(db, new Date(now.getTime() - 30 * 86_400_000))} webhookUrl={`${cfg.PUBLIC_BASE_URL}/webhooks/instagram`} />,
      ),
    );
  });

  web.post("/cockpit/regles", async (c) => {
    const form = await c.req.parseBody();
    const keywords = String(form.mots ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (keywords.length) {
      await upsertCommentRule(db, {
        keywords,
        media_id: form.media ? String(form.media).trim() : null,
        dm_text: form.dm ? String(form.dm).trim() : null,
        public_reply: form.public ? String(form.public).trim() : null,
      });
    }
    return c.redirect("/cockpit/reglages");
  });
  web.post("/cockpit/regles/:id/supprimer", async (c) => {
    await deleteCommentRule(db, c.req.param("id"));
    return c.redirect("/cockpit/reglages");
  });

  web.onError((err, c) => {
    log.error("erreur HTTP", { path: c.req.path, error: err });
    return c.text("Erreur interne", 500);
  });

  return web;
}
