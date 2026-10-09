import { afterEach, describe, expect, it } from "vitest";
import { fake, type LlmRequest } from "../src/ai/llm.js";
import { parseWebhook } from "../src/instagram/webhook.js";
import { getLead } from "../src/db/repo/leads.js";
import { conversationHistory } from "../src/db/repo/messages.js";
import { upsertCommentRule, listEvents } from "../src/db/repo/misc.js";
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
});
