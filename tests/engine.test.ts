import { afterEach, describe, expect, it } from "vitest";
import { fake, type LlmRequest } from "../src/ai/llm.js";
import { parseWebhook } from "../src/instagram/webhook.js";
import { getLead } from "../src/db/repo/leads.js";
import { conversationHistory } from "../src/db/repo/messages.js";
import { upsertCommentRule, listEvents, recordUsage } from "../src/db/repo/misc.js";
import { IgError } from "../src/instagram/client.js";
import { insertMessage } from "../src/db/repo/messages.js";
import { getOrCreateConversation } from "../src/db/repo/conversations.js";
import { upsertContact } from "../src/db/repo/contacts.js";
import { findContactByExternal } from "../src/db/repo/contacts.js";
import { latestConversationForContact } from "../src/db/repo/conversations.js";
import { hasToolResults, igMessageWebhook, lastUserText, makeApp, type TestApp } from "./helpers.js";

let app: TestApp | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

const BRIEF = {
  nom_app: "Coachly",
  promesse: "Gérer ses séances et ses paiements en un geste.",
  cible: "Coachs sportifs indépendants",
  probleme: "Trop de temps perdu en messages et relances de paiement",
  fonctionnalites_mvp: ["Planning", "Paiement", "Suivi"],
  parcours_principal: ["Ouvre l'app", "Voit ses séances", "Encaisse"],
  ecrans: [
    { titre: "Accueil", role: "Séances du jour" },
    { titre: "Client", role: "Fiche client" },
    { titre: "Paiement", role: "Encaissement" },
  ],
  direction_artistique: { ambiance: "Énergique et premium", couleurs: ["#0F172A", "#22C55E", "#F8FAFC"], typographie: "SF Pro" },
  perimetre_21_jours: ["Planning", "Paiement Apple Pay"],
  questions_pour_l_appel: ["Combien de clients ?"],
  points_de_vigilance: ["Paiements"],
};

/** Scénario complet : découverte, budget validé, ébauche, proposition d'appel. */
function salesScript(req: LlmRequest, n: number) {
  if (req.purpose === "ebauche_brief") return [fake.json(BRIEF)];
  if (req.purpose === "ebauche_ecrans") return [fake.json({ ecrans: [{ titre: "Accueil", html: "<style>.e1-a{color:red}</style><div class='e1-a'>Séances</div>" }] })];
  if (req.purpose === "analyse") {
    return [fake.json({ resume: "Coach qui veut son app.", temperature: "chaud", prochaine_action: "Confirmer le RDV", relance_manuelle: "", signaux: [], risques: [] })];
  }
  const user = lastUserText(req);
  if (req.purpose === "conversation" && user.includes("coachs sportifs") && !hasToolResults(req)) {
    return [fake.tool("maj_fiche", { projet: "App pour coachs sportifs", cible: "coachs sportifs" })];
  }
  if (req.purpose === "conversation" && user.includes("coachs sportifs")) {
    return [fake.json({ messages: ["Hello ! Moi c'est Nova, l'IA de YD Studio 👋", "Une app pour les coachs sportifs, j'adore. Elle servirait à quoi au quotidien ?"], boutons: [], relance_utile: true, note_equipe: "" })];
  }
  if (req.purpose === "conversation" && user.includes("8000") && !hasToolResults(req)) {
    return [
      fake.tool("maj_fiche", {
        description: "Planning, paiement et suivi des clients pour coachs",
        fonctionnalites: ["planning", "paiement", "suivi"],
        budget_estime_eur: 8000,
        budget_suffisant: "oui",
        financement: ["fonds_propres"],
      }),
      fake.tool("lancer_ebauche", { resume: "App de gestion pour coachs sportifs", fonctionnalites_cles: ["planning", "paiement", "suivi"], ambiance_visuelle: "" }),
      fake.tool("proposer_rdv", {}),
    ];
  }
  if (req.purpose === "conversation" && user.includes("8000")) {
    return [fake.json({ messages: ["Parfait. L'équipe lance une première ébauche de ton app.", "On te la montre en 10 min en visio ? Réserve ici : https://cal.com/yd-studio/decouverte"], boutons: ["Je réserve"], relance_utile: true, note_equipe: "Budget 8 k€ validé" })];
  }
  if (req.purpose === "relance") return [fake.json({ envoyer: true, message: "Tu as pu regarder les créneaux ? Ton ébauche t'attend.", raison: "Relance 1" })];
  throw new Error(`appel inattendu n°${n} : ${req.purpose} / ${user.slice(0, 80)}`);
}

describe("moteur de conversation", () => {
  it("mène une conversation jusqu'à la proposition d'appel", async () => {
    app = await makeApp(salesScript);
    const t0 = app.fakeClock.now().getTime();
    await app.engine.handleEvents(parseWebhook(igMessageWebhook("IGSID-42", "mid.a", "Salut ! J'ai une idée d'app pour les coachs sportifs", t0)));

    // Rien ne part avant la fin du délai de regroupement.
    expect(await app.worker.drain()).toBe(0);
    app.fakeClock.advance(9_000);
    await app.worker.drain();

    const first = app.ig.sent.filter((s) => s.type === "text");
    expect(first).toHaveLength(2);
    expect(first[0]!.text).toContain("l'IA de YD Studio");
    expect(app.ig.actions.some((a) => a.action === "typing_on")).toBe(true);
    expect(app.ig.actions.some((a) => a.action === "mark_seen")).toBe(true);

    const contact = (await findContactByExternal(app.db, "instagram", "IGSID-42"))!;
    let lead = await getLead(app.db, contact.id);
    expect(lead.stage).toBe("decouverte");
    expect(lead.fiche.projet).toBe("App pour coachs sportifs");

    // Deuxième message : budget validé, ébauche, rendez-vous.
    app.fakeClock.advance(60_000);
    await app.engine.handleEvents(
      parseWebhook(igMessageWebhook("IGSID-42", "mid.b", "Gestion des séances, paiement, suivi. J'ai 8000€ de côté", app.fakeClock.now().getTime())),
    );
    app.fakeClock.advance(9_000);
    await app.worker.drain();

    lead = await getLead(app.db, contact.id);
    expect(lead.budget_status).toBe("ok");
    expect(lead.stage).toBe("rdv_propose");
    expect(lead.ebauche_id).toBeTruthy();
    expect(lead.score).toBeGreaterThanOrEqual(60);
    expect(lead.temperature).toBe("brulant");

    const texts = app.ig.sent.filter((s) => s.type === "text");
    expect(texts).toHaveLength(4);
    expect(texts[3]!.quickReplies).toEqual(["Je réserve"]);

    // L'ébauche a été générée (brief + écrans) et l'équipe prévenue.
    const titles = app.notes.sent.map((n) => n.title);
    expect(titles.some((t) => t.startsWith("Budget validé"))).toBe(true);
    expect(titles.some((t) => t.startsWith("Ébauche lancée"))).toBe(true);
    expect(titles.some((t) => t.startsWith("Ébauche prête"))).toBe(true);

    // Relance dans la fenêtre si la personne ne répond pas.
    app.fakeClock.advance(3 * 3_600_000 + 60_000);
    await app.worker.drain();
    const after = app.ig.sent.filter((s) => s.type === "text");
    expect(after.at(-1)!.text).toContain("Ton ébauche t'attend");
  });

  it("ajoute la présentation de l'IA si le modèle l'oublie", async () => {
    app = await makeApp(() => [fake.json({ messages: ["Salut ! Raconte-moi ton projet ?"], boutons: [], relance_utile: false, note_equipe: "" })]);
    await app.engine.handleEvents(parseWebhook(igMessageWebhook("U1", "m1", "hello", app.fakeClock.now().getTime())));
    app.fakeClock.advance(9_000);
    await app.worker.drain();
    const texts = app.ig.sent.map((s) => s.text);
    expect(texts[0]).toMatch(/l'IA de YD Studio/);
  });

  it("met l'IA en pause quand l'équipe répond depuis Instagram", async () => {
    app = await makeApp(() => [fake.json({ messages: ["Moi c'est Nova, l'IA de YD Studio. Ton projet ?"], boutons: [], relance_utile: false, note_equipe: "" })]);
    const t = app.fakeClock.now().getTime();
    await app.engine.handleEvents(parseWebhook(igMessageWebhook("U2", "m1", "Bonjour", t)));
    app.fakeClock.advance(9_000);
    await app.worker.drain();
    // L'équipe écrit à la main depuis l'app Instagram : écho avec un identifiant inconnu.
    await app.engine.handleEvents(
      parseWebhook({
        object: "instagram",
        entry: [{ id: "17841400000000000", time: t, messaging: [{ sender: { id: "17841400000000000" }, recipient: { id: "U2" }, timestamp: t + 20_000, message: { mid: "human.1", text: "Salut, c'est Yanis de l'équipe !", is_echo: true } }] }],
      }),
    );
    await app.engine.handleEvents(parseWebhook(igMessageWebhook("U2", "m2", "Super merci", t + 60_000)));
    app.fakeClock.advance(60_000);
    await app.worker.drain();
    expect(app.ig.sent.filter((s) => s.type === "text")).toHaveLength(1);
    const contact = (await findContactByExternal(app.db, "instagram", "U2"))!;
    const conv = (await latestConversationForContact(app.db, contact.id))!;
    expect(conv.ai_paused_until).toBeTruthy();
    const hist = await conversationHistory(app.db, conv.id);
    expect(hist.some((m) => m.author === "humain")).toBe(true);
    expect(app.notes.sent.some((n) => n.title.includes("reprise par l'équipe"))).toBe(true);
  });

  it("respecte une demande d'arrêt", async () => {
    app = await makeApp(() => {
      throw new Error("l'IA ne doit pas être appelée");
    });
    await app.engine.handleEvents(parseWebhook(igMessageWebhook("U3", "m1", "STOP", app.fakeClock.now().getTime())));
    app.fakeClock.advance(10_000);
    await app.worker.drain();
    const contact = (await findContactByExternal(app.db, "instagram", "U3"))!;
    expect(contact.opted_out_at).toBeTruthy();
    expect(app.ig.sent).toHaveLength(1);
    expect(app.ig.sent[0]!.text).toContain("je ne t'écrirai plus");
  });

  it("ne répond jamais hors de la fenêtre de 24 h", async () => {
    app = await makeApp(() => [fake.json({ messages: ["Moi c'est Nova, l'IA de YD Studio."], boutons: [], relance_utile: false, note_equipe: "" })], { REPLY_DEBOUNCE_SECONDS: "8" });
    const old = app.fakeClock.now().getTime() - 25 * 3_600_000;
    await app.engine.handleEvents(parseWebhook(igMessageWebhook("U4", "m1", "Coucou", old)));
    app.fakeClock.advance(9_000);
    await app.worker.drain();
    expect(app.ig.sent).toHaveLength(0);
    const ev = await listEvents(app.db, { types: ["fenetre_fermee"] });
    expect(ev.length).toBe(1);
  });

  it("répond en privé à un commentaire avec mot-clé", async () => {
    app = await makeApp(() => {
      throw new Error("pas d'IA ici");
    });
    await upsertCommentRule(app.db, { keywords: ["APP"], public_reply: "Je t'ai écrit en DM 📩" });
    const body = {
      object: "instagram",
      entry: [{ id: "17841400000000000", time: 1791800000, changes: [{ field: "comments", value: { id: "c-1", text: "app 🔥", from: { id: "U5", username: "lea.founder" }, media: { id: "media-1", media_product_type: "REELS" } } }] }],
    };
    await app.engine.handleEvents(parseWebhook(body));
    await app.engine.handleEvents(parseWebhook(body)); // webhook rejoué
    await app.worker.drain();
    const priv = app.ig.sent.filter((s) => s.type === "private_reply");
    expect(priv).toHaveLength(1);
    expect(priv[0]!.text).toContain("@lea.founder");
    expect(app.ig.sent.filter((s) => s.type === "comment_reply")[0]!.text).toBe("Je t'ai écrit en DM 📩");
  });

  it("fonctionne en bac à sable sans rien envoyer sur Instagram", async () => {
    app = await makeApp(() => [fake.json({ messages: ["Moi c'est Nova, l'IA de YD Studio. Ton projet ?"], boutons: [], relance_utile: true, note_equipe: "" })]);
    await app.engine.onInbound({ channel: "bac_a_sable", externalUserId: "session-1", mid: null, text: "Test", kind: "texte", payload: {}, source: "bac_a_sable", at: app.fakeClock.now() });
    app.fakeClock.advance(3_000);
    await app.worker.drain();
    expect(app.ig.sent).toHaveLength(0);
    expect(app.sandboxMessenger.sent).toHaveLength(1);
  });

  it("alerte l'équipe une seule fois par mois quand le budget IA est dépassé", async () => {
    app = await makeApp(() => [], { AI_MONTHLY_BUDGET_USD: "5" });
    await recordUsage(app.db, { purpose: "conversation", model: "claude-sonnet-5-5", input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 6.5 });
    await app.scheduler.tick();
    await app.worker.drain();
    app.fakeClock.advance(11 * 60_000);
    await app.scheduler.tick();
    await app.worker.drain();
    const alerts = app.notes.sent.filter((n) => n.kind === "budget_ia");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.title).toBe("Budget IA dépassé : 6.50 $ ce mois-ci");
  });

});

/* ------------------------- Régressions de la revue du moteur ------------------------- */

const reply = (...messages: string[]) => [fake.json({ messages, boutons: [], relance_utile: true, note_equipe: "" })];
const analyse = (prochaine = "Relancer dans une semaine") => [fake.json({ resume: "x", temperature: "tiede", prochaine_action: prochaine, relance_manuelle: "", signaux: [], risques: [] })];
const send = (a: TestApp, sender: string, mid: string, text: string) => a.engine.handleEvents(parseWebhook(igMessageWebhook(sender, mid, text, a.fakeClock.now().getTime())));
const texts = (a: TestApp) => a.ig.sent.filter((x) => x.type === "text").map((x) => x.text);

describe("moteur : cas limites", () => {
  it("n'envoie qu'une réponse quand la personne écrit pendant que Nova réfléchit", async () => {
    let calls = 0;
    app = await makeApp(async (req) => {
      if (req.purpose !== "conversation") return analyse();
      calls++;
      // Le deuxième message arrive pendant la génération de la première réponse.
      if (calls === 1) await send(app!, "U-race", "m2", "j'ai une idée d'app de covoiturage");
      return reply(`Moi c'est Nova, l'IA de YD Studio. Réponse ${calls}`);
    });
    await send(app, "U-race", "m1", "Salut");
    app.fakeClock.advance(9_000);
    await app.worker.drain();
    expect(texts(app)).toEqual([]); // la première réponse est abandonnée : elle ignorait le 2e message
    app.fakeClock.advance(9_000);
    await app.worker.drain();
    app.fakeClock.advance(9_000);
    await app.worker.drain();
    expect(texts(app)).toEqual(["Moi c'est Nova, l'IA de YD Studio. Réponse 2"]);
    expect(calls).toBe(2);
  });

  it("réessaie un envoi en échec passager au lieu de perdre la réponse", async () => {
    app = await makeApp((req) => (req.purpose === "conversation" ? reply("Moi c'est Nova, l'IA de YD Studio.", "Quel budget as-tu prévu ?") : analyse()));
    await send(app, "U-t", "m1", "Bonjour, j'ai un projet");
    app.fakeClock.advance(9_000);
    app.ig.failNext = new IgError("(#4) Application request limit reached", 4, null, 400);
    await app.worker.drain();
    expect(texts(app)).toEqual([]);
    app.fakeClock.advance(31_000);
    await app.worker.drain();
    expect(texts(app)).toEqual(["Moi c'est Nova, l'IA de YD Studio.", "Quel budget as-tu prévu ?"]);
    expect(app.notes.sent.filter((n) => n.kind === "envoi_impossible")).toHaveLength(0);
  });

  it("prévient l'équipe et ne relance pas quand un message ne peut pas partir", async () => {
    app = await makeApp((req) => (req.purpose === "conversation" ? reply("Moi c'est Nova, l'IA de YD Studio.", "Ton projet ?") : analyse()));
    await send(app, "U-p", "m1", "Bonjour");
    app.fakeClock.advance(9_000);
    app.ig.failNext = new IgError("(#10) This message is sent outside of allowed window", 10, 2018278, 400);
    await app.worker.drain();
    const rows = await app.db.query<{ status: string }>("SELECT status FROM messages WHERE direction = 'sortant' ORDER BY created_at");
    expect(rows.map((r) => r.status)).toEqual(["echec", "annule"]);
    expect(app.notes.sent.map((n) => n.kind)).toContain("envoi_impossible");
    const relances = await app.db.query("SELECT id FROM jobs WHERE type = 'relancer' AND status = 'en_attente'");
    expect(relances).toHaveLength(0);
  });

  it("envoie le dernier message quand l'IA passe la main, et l'analyse ne l'efface pas", async () => {
    app = await makeApp((req) => {
      if (req.purpose === "analyse") return analyse("Ne plus relancer");
      if (!hasToolResults(req)) return [fake.tool("passer_la_main", { raison: "Négociation de prix", urgence: "haute" })];
      return reply("Moi c'est Nova, l'IA de YD Studio. Je laisse quelqu'un de l'équipe te répondre, il revient vers toi très vite.");
    });
    await send(app, "U-h", "m1", "Je veux une remise de 50 %");
    app.fakeClock.advance(9_000);
    await app.worker.drain();
    expect(texts(app)).toEqual(["Moi c'est Nova, l'IA de YD Studio. Je laisse quelqu'un de l'équipe te répondre, il revient vers toi très vite."]);
    app.fakeClock.advance(31 * 60_000);
    await app.worker.drain();
    const lead = await app.db.one<{ next_action: string }>("SELECT next_action FROM leads");
    expect(lead?.next_action).toBe("Répondre à la main : Négociation de prix");
  });

  it("confirme la désinscription demandée en toutes lettres", async () => {
    app = await makeApp((req) => {
      if (req.purpose !== "conversation") return analyse();
      if (!hasToolResults(req)) return [fake.tool("desinscrire", { effacer_donnees: true })];
      return reply("C'est noté, tu ne recevras plus de messages et tes informations vont être supprimées.");
    });
    await send(app, "U-d", "m1", "Merci mais je ne suis plus intéressé, ne m'envoyez plus rien et supprimez mes infos");
    app.fakeClock.advance(9_000);
    await app.worker.drain();
    expect(texts(app).at(-1)).toBe("C'est noté, tu ne recevras plus de messages et tes informations vont être supprimées.");
  });

  it("ne prend pas un enthousiasme pour une demande d'arrêt", async () => {
    app = await makeApp((req) => (req.purpose === "conversation" ? reply("Moi c'est Nova, l'IA de YD Studio. Trop content que ça te plaise !") : analyse()));
    await send(app, "U-o", "m1", "Arrête, c'est trop bien !");
    app.fakeClock.advance(9_000);
    await app.worker.drain();
    const contact = await findContactByExternal(app.db, "instagram", "U-o");
    expect(contact?.opted_out_at).toBeNull();
    expect(texts(app)).toEqual(["Moi c'est Nova, l'IA de YD Studio. Trop content que ça te plaise !"]);
  });

  it("n'écrit pas en privé à une personne désinscrite qui commente un mot-clé", async () => {
    app = await makeApp(() => analyse());
    await upsertCommentRule(app.db, { keywords: ["APP"] });
    await send(app, "U-opt", "m1", "STOP");
    const before = app.ig.sent.length;
    await app.engine.handleEvents(
      parseWebhook({ object: "instagram", entry: [{ id: "17841400000000000", time: 1791800000, changes: [{ field: "comments", value: { id: "c-9", text: "APP", from: { id: "U-opt", username: "ex.prospect" }, media: { id: "media-1" } } }] }] }),
    );
    await app.worker.drain();
    expect(app.ig.sent.slice(before)).toEqual([]);
  });

  it("reconnaît l'écho d'un message de l'équipe arrivé avant la réponse de l'API", async () => {
    app = await makeApp((req) => (req.purpose === "conversation" ? reply("Moi c'est Nova, l'IA de YD Studio. Ton projet ?") : analyse()));
    await send(app, "U-e", "m1", "Bonjour");
    app.fakeClock.advance(9_000);
    await app.worker.drain();
    const contact = (await findContactByExternal(app.db, "instagram", "U-e"))!;
    const conv = (await latestConversationForContact(app.db, contact.id))!;
    const original = app.ig.sendText.bind(app.ig);
    app.ig.sendText = async (to, text, qr, o) => {
      const res = await original(to, text, qr, o);
      const t = app!.fakeClock.now().getTime();
      await app!.engine.handleEvents(parseWebhook({ object: "instagram", entry: [{ id: "17841400000000000", time: t, messaging: [{ sender: { id: "17841400000000000" }, recipient: { id: to }, timestamp: t, message: { mid: res.messageId, text, is_echo: true } }] }] }));
      return res;
    };
    expect(await app.engine.sendHumanMessage(conv.id, "Bonjour, ici Yanis de l'équipe")).toEqual({ ok: true });
    const rows = await app.db.query<{ author: string; status: string }>("SELECT author, status FROM messages WHERE direction = 'sortant' ORDER BY created_at");
    expect(rows).toEqual([
      { author: "ia", status: "envoye" },
      { author: "humain", status: "envoye" },
    ]);
  });

  it("répond une seule fois aux deux premiers messages simultanés d'un nouveau contact", async () => {
    app = await makeApp((req) => (req.purpose === "conversation" ? reply("Moi c'est Nova, l'IA de YD Studio. Raconte-moi !") : analyse()));
    app.ig.profiles.set("U-new", { username: "new.person" });
    const t = app.fakeClock.now().getTime();
    await Promise.all([
      app.engine.handleEvents(parseWebhook(igMessageWebhook("U-new", "mA", "Bonjour", t))),
      app.engine.handleEvents(parseWebhook(igMessageWebhook("U-new", "mB", "J'ai un projet d'app", t + 800))),
    ]);
    expect(await app.db.query("SELECT id FROM conversations WHERE status = 'ouverte'")).toHaveLength(1);
    app.fakeClock.advance(9_000);
    await app.worker.drain();
    expect(texts(app)).toEqual(["Moi c'est Nova, l'IA de YD Studio. Raconte-moi !"]);
  });

  it("programme la réponse d'un webhook rejoué dont le premier traitement avait échoué", async () => {
    app = await makeApp((req) => (req.purpose === "conversation" ? reply("Moi c'est Nova, l'IA de YD Studio. Ton projet ?") : analyse()));
    // Premier passage interrompu : le message est enregistré, mais aucune réponse n'est programmée.
    const { contact } = await upsertContact(app.db, "instagram", "U-replay");
    const { conversation } = await getOrCreateConversation(app.db, contact.id, "instagram", "dm");
    await insertMessage(app.db, { conversation_id: conversation.id, direction: "entrant", author: "prospect", text: "Bonjour", external_id: "m-replay", created_at: app.fakeClock.now() });
    await send(app, "U-replay", "m-replay", "Bonjour"); // Meta renvoie le webhook
    app.fakeClock.advance(9_000);
    await app.worker.drain();
    expect(texts(app)).toEqual(["Moi c'est Nova, l'IA de YD Studio. Ton projet ?"]);
  });

  it("une désinscription posée à la main coupe vraiment les messages automatiques", async () => {
    app = await makeApp((req) => (req.purpose === "conversation" ? reply("Moi c'est Nova, l'IA de YD Studio.") : analyse()));
    await send(app, "U-m", "m1", "Bonjour");
    const contact = (await findContactByExternal(app.db, "instagram", "U-m"))!;
    await app.engine.setStageManually(contact.id, "desinscrit", "cockpit");
    app.fakeClock.advance(9_000);
    await app.worker.drain();
    expect(texts(app)).toEqual([]);
    expect((await findContactByExternal(app.db, "instagram", "U-m"))?.opted_out_at).not.toBeNull();
  });

  it("n'envoie pas l'aperçu d'ébauche à une personne qui s'est désinscrite, et son image n'est pas prise pour une reprise humaine", async () => {
    for (const scenario of ["desinscription", "normal"] as const) {
      app = await makeApp(
        async (req) => {
          if (req.purpose === "ebauche_brief") {
            if (scenario === "desinscription") await send(app!, "U-x", "m-stop", "STOP");
            return [fake.json(BRIEF)];
          }
          if (req.purpose === "ebauche_ecrans") return [fake.json({ ecrans: [{ titre: "Accueil", html: "<div>x</div>" }] })];
          if (req.purpose !== "conversation") return analyse();
          if (!hasToolResults(req)) {
            return [
              fake.tool("maj_fiche", { description: "App coachs", cible: "coachs", fonctionnalites: ["planning", "paiement"], budget_estime_eur: 8000 }),
              fake.tool("lancer_ebauche", { resume: "App coachs", fonctionnalites_cles: ["planning"], ambiance_visuelle: "" }),
            ];
          }
          return reply("Moi c'est Nova, l'IA de YD Studio. Je lance ton ébauche !");
        },
        { EBAUCHE_TEASER: "flou" },
      );
      (app.engine as unknown as { d: { renderer: unknown } }).d.renderer = { render: async () => ({ board: Buffer.from([1]), teaser: Buffer.from([2]), screens: [] }), close: async () => {} };
      await send(app, "U-x", "m1", "J'ai 8000 € pour une app de coachs");
      app.fakeClock.advance(9_000);
      await app.worker.drain();
      const images = app.ig.sent.filter((x) => x.type === "image");
      if (scenario === "desinscription") {
        expect(images).toHaveLength(0);
      } else {
        expect(images).toHaveLength(1);
        const index = app.ig.sent.indexOf(images[0]!) + 1; // identifiants séquentiels du faux messager
        const t = app.fakeClock.now().getTime();
        await app.engine.handleEvents(
          parseWebhook({ object: "instagram", entry: [{ id: "17841400000000000", time: t, messaging: [{ sender: { id: "17841400000000000" }, recipient: { id: "U-x" }, timestamp: t, message: { mid: `fake-mid-${index}`, attachments: [{ type: "image", payload: { url: images[0]!.url } }], is_echo: true } }] }] }),
        );
        const conv = await app.db.one<{ ai_paused_until: Date | null }>("SELECT ai_paused_until FROM conversations");
        expect(conv?.ai_paused_until).toBeNull();
      }
      await app.close();
      app = null;
    }
  });
});

