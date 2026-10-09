import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { loadStudio } from "../src/studio/knowledge.js";
import { seededRng } from "../src/util/pure.js";
import { buildLaboData } from "../labo/data.js";
import { SCENARIOS, LIBRE, scenarioById } from "../labo/personas.js";
import {
  addProspectMessage,
  applyTools,
  awaitingNova,
  cancelBubbles,
  correctionRequest,
  newState,
  novaRequest,
  parseNovaReply,
  parsePersona,
  parseRelance,
  personaInput,
  recordRelance,
  recordReply,
  relanceInput,
  relanceStatus,
  silenceReason,
  type LaboState,
} from "../labo/runtime.js";

const cfg = loadConfig({} as NodeJS.ProcessEnv);
const data = buildLaboData(cfg, loadStudio(cfg), new Date("2026-10-12T08:00:00Z"));
const T0 = Date.parse("2026-10-12T08:05:00Z"); // lundi 10 h 05 à Paris
const opts = { now: T0, bookingUrl: "" };

function reply(state: LaboState, json: unknown, now = T0) {
  const parsed = parseNovaReply(typeof json === "string" ? json : JSON.stringify(json));
  const req = novaRequest(state, data, { now, bookingUrl: "" });
  const { calls, refused } = applyTools(state, data, parsed, { now, bookingUrl: "" });
  const rec = recordReply(state, data, parsed, calls, {
    now,
    modelChoice: "sonnet",
    modelLabel: "Sonnet 5.5",
    durationMs: 4000,
    corrected: false,
    context: req.context,
    firstMessage: req.firstMessage,
    rng: seededRng(3),
  });
  return { rec, refused, calls, req };
}

describe("Labo : données et scénarios", () => {
  it("embarque les prompts de production rendus et les outils", () => {
    expect(data.prompts.conversation).toContain("Tu es Nova, l'IA de YD Studio");
    expect(data.prompts.conversation).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(data.tools.map((t) => t.name)).toEqual(["maj_fiche", "lancer_ebauche", "proposer_rdv", "noter_rdv", "passer_la_main", "clore_conversation", "desinscrire"]);
    expect(data.relanceDelaysMs).toEqual([3 * 3_600_000, 21 * 3_600_000]);
    expect(data.budgetMin).toBe(5000);
  });

  it("a des scénarios complets et un scénario libre", () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(8);
    for (const s of SCENARIOS) {
      expect(s.ouverture.text, s.id).not.toBe("");
      expect(s.jeu.secret, s.id).not.toBe("");
    }
    expect(scenarioById("inconnu")).toBe(LIBRE);
  });
});

describe("Labo : demande à Nova", () => {
  it("reprend le prompt maître, les tours et le contexte du moteur", () => {
    const state = newState(scenarioById("sarah"), T0);
    const req = novaRequest(state, data, opts);
    expect(req.firstMessage).toBe(true);
    expect(req.input[0]!.content.startsWith(data.prompts.conversation)).toBe(true);
    expect(req.input[0]!.content).toContain("# Mode labo");
    const last = req.input.at(-1)!;
    expect(last.role).toBe("user");
    expect(last.content).toContain("On lance Maternia");
    expect(last.content).toContain("C'est ton premier message dans cette conversation");
    expect(last.content).toContain("publicité Instagram");
    expect(last.content).toContain("Conversation de test interne");
    expect(last.content).toContain("[Format]");
  });

  it("traduit une question d'accueil comme le moteur", () => {
    const state = newState(scenarioById("hugo"), T0);
    const last = novaRequest(state, data, opts).input.at(-1)!;
    expect(last.content).toContain("[A touché le bouton « Combien coûte une app ? »]");
  });

  it("lit une réponse JSON, même entourée de texte, et retombe sur le texte brut sinon", () => {
    const ok = parseNovaReply('Voilà :\n{"outils":[{"nom":"maj_fiche","arguments":{"prenom":"Sarah"}}],"messages":["Salut"],"boutons":[],"relance_utile":true,"note_equipe":""}');
    expect(ok.formatOk).toBe(true);
    expect(ok.outils[0]).toEqual({ nom: "maj_fiche", arguments: { prenom: "Sarah" } });
    const brut = parseNovaReply("Bonjour Sarah !\n\nTon app sert à quoi ?");
    expect(brut.formatOk).toBe(false);
    expect(brut.messages).toEqual(["Bonjour Sarah !", "Ton app sert à quoi ?"]);
  });
});

describe("Labo : outils et parcours", () => {
  it("valide le budget, lance l'ébauche et propose l'appel dans le même tour", () => {
    const state = newState(scenarioById("sarah"), T0);
    const { rec, refused } = reply(state, {
      outils: [
        { nom: "maj_fiche", arguments: { prenom: "Sarah", projet: "Maternia", cible: "futures mamans", fonctionnalites: ["suivi", "rdv", "visio"], budget_estime_eur: 9000, budget_declare: "8 à 10 k€" } },
        { nom: "lancer_ebauche", arguments: { resume: "Suivi de grossesse", fonctionnalites_cles: ["suivi", "rdv"], ambiance_visuelle: "" } },
        { nom: "proposer_rdv", arguments: {} },
      ],
      messages: ["Top projet !", "On te montre l'ébauche en 10 min ?"],
      boutons: ["Mardi 13 oct. 10 h"],
      relance_utile: true,
      note_equipe: "",
    });
    expect(refused).toBe(false);
    expect(state.lead.budget_status).toBe("ok");
    expect(state.lead.stage).toBe("rdv_propose");
    expect(state.lead.temperature).toBe("brulant");
    expect(state.ebauche?.resume).toBe("Suivi de grossesse");
    expect(state.notifications.map((n) => n.titre)).toEqual(["[Labo] Budget validé : Sarah (@maternia.app)", "[Labo] Ébauche lancée : Sarah (@maternia.app)"]);
    // Le premier message ne mentionnait pas l'IA : la présentation est ajoutée.
    expect(rec.messages[0]).toBe("Moi c'est Nova, l'IA de YD Studio. L'équipe suit nos échanges.");
    expect(rec.messages).toHaveLength(3);
    expect(rec.plan).toHaveLength(3);
    expect(awaitingNova(state)).toBe(false);
  });

  it("refuse l'ébauche sans budget et prépare un tour de correction", () => {
    const state = newState(scenarioById("camille"), T0);
    const raw = JSON.stringify({ outils: [{ nom: "lancer_ebauche", arguments: { resume: "x", fonctionnalites_cles: [], ambiance_visuelle: "" } }], messages: ["Je lance ton ébauche !"], boutons: [], relance_utile: false, note_equipe: "" });
    const parsed = parseNovaReply(raw);
    const req = novaRequest(state, data, opts);
    const { calls, refused } = applyTools(state, data, parsed, opts);
    expect(refused).toBe(true);
    expect(state.ebauche).toBeNull();
    const second = correctionRequest(req, raw, calls);
    expect(second.at(-2)).toEqual({ role: "assistant", content: raw });
    expect(second.at(-1)!.content).toContain('"refuse":true');
  });

  it("note le rendez-vous, puis s'arrête de relancer", () => {
    const state = newState(scenarioById("sarah"), T0);
    reply(state, { outils: [{ nom: "maj_fiche", arguments: { budget_suffisant: "oui" } }], messages: ["Moi c'est Nova, l'IA de YD Studio."], boutons: [], relance_utile: true, note_equipe: "" });
    addProspectMessage(state, "Mercredi 14 h 30, sarah@exemple.fr", T0 + 60_000);
    reply(
      state,
      { outils: [{ nom: "noter_rdv", arguments: { quand: "2026-10-14T14:30:00+02:00", email: "sarah@exemple.fr", remarque: "" } }], messages: ["Noté !"], boutons: [], relance_utile: false, note_equipe: "RDV noté" },
      T0 + 120_000,
    );
    expect(state.lead.stage).toBe("rdv_pris");
    expect(state.lead.rdv_at).toBe("2026-10-14T12:30:00.000Z");
    expect(state.contact.email).toBe("sarah@exemple.fr");
    expect(state.notifications.some((n) => n.urgent && n.titre.includes("RDV demandé"))).toBe(true);
    expect(relanceStatus(state, data, T0 + 130_000)).toEqual({ possible: false, raison: "Étape « RDV pris » : pas de relance." });
  });

  it("met l'IA en pause après un passage de main, et se tait après une désinscription", () => {
    const state = newState(scenarioById("testeur"), T0);
    reply(state, { outils: [{ nom: "passer_la_main", arguments: { raison: "Veut un humain", urgence: "normale" } }], messages: ["Je préviens l'équipe."], boutons: [], relance_utile: false, note_equipe: "" });
    expect(silenceReason(state, T0 + 1000)).toMatch(/IA en pause/);
    const other = newState(scenarioById("ines"), T0);
    reply(other, { outils: [{ nom: "desinscrire", arguments: { effacer_donnees: true } }], messages: ["Bien noté."], boutons: [], relance_utile: false, note_equipe: "" });
    expect(other.lead.stage).toBe("desinscrit");
    expect(silenceReason(other, T0 + 1000)).toMatch(/Désinscrit/);
  });

  it("annule les bulles restantes quand le prospect répond pendant l'envoi", () => {
    const state = newState(scenarioById("marc"), T0);
    const { rec } = reply(state, { outils: [], messages: ["Je suis Nova, l'IA de YD Studio.", "Une app de fidélité, bonne idée.", "Combien de clients par jour ?"], boutons: [], relance_utile: true, note_equipe: "" });
    expect(cancelBubbles(state, rec.id, 1)).toBe(2);
    expect(state.messages.filter((m) => m.status === "annule")).toHaveLength(2);
  });
});

describe("Labo : relances", () => {
  it("suit le calendrier de production : +3 h, puis +21 h, dans la fenêtre de 24 h", () => {
    const state = newState(scenarioById("camille"), T0);
    reply(state, { outils: [], messages: ["Moi c'est Nova, l'IA de YD Studio. Ton app servirait à quoi ?"], boutons: [], relance_utile: true, note_equipe: "" });
    const first = relanceStatus(state, data, T0);
    expect(first).toEqual({ possible: true, numero: 1, total: 2, at: T0 + 3 * 3_600_000 });
    expect(relanceInput(state, data, 1, 2, T0)).toContain("Relance n°1 sur 2.");
    if (!first.possible) throw new Error("relance attendue");
    recordRelance(state, data, first, parseRelance('{"envoyer":true,"message":"Tu as pu y repenser ?","raison":"Relance utile"}'), { modelChoice: "sonnet", modelLabel: "Sonnet 5.5", durationMs: 2000, rng: seededRng(1) });
    const second = relanceStatus(state, data, first.at);
    expect(second).toEqual({ possible: true, numero: 2, total: 2, at: T0 + 21 * 3_600_000 });
    if (!second.possible) throw new Error("relance attendue");
    recordRelance(state, data, second, { envoyer: true, message: "Dernier petit message !", raison: "" }, { modelChoice: "sonnet", modelLabel: "Sonnet 5.5", durationMs: 2000, rng: seededRng(1) });
    expect(relanceStatus(state, data, second.at)).toEqual({ possible: false, raison: "Les 2 relances ont été envoyées : la suite revient à l'équipe." });
  });

  it("ne relance pas si Nova l'a jugé inutile ou si elle y renonce", () => {
    const state = newState(scenarioById("camille"), T0);
    reply(state, { outils: [], messages: ["Moi c'est Nova, l'IA de YD Studio."], boutons: [], relance_utile: false, note_equipe: "" });
    expect(relanceStatus(state, data, T0)).toMatchObject({ possible: false });
    const other = newState(scenarioById("camille"), T0);
    reply(other, { outils: [], messages: ["Moi c'est Nova, l'IA de YD Studio."], boutons: [], relance_utile: true, note_equipe: "" });
    const st = relanceStatus(other, data, T0);
    if (!st.possible) throw new Error("relance attendue");
    recordRelance(other, data, st, parseRelance('{"envoyer":false,"message":"","raison":"Ce serait insistant"}'), { modelChoice: "sonnet", modelLabel: "Sonnet 5.5", durationMs: 1, rng: seededRng(1) });
    expect(relanceStatus(other, data, st.at)).toEqual({ possible: false, raison: "Nova a renoncé à relancer : Ce serait insistant." });
  });
});

describe("Labo : prospect simulé", () => {
  it("donne au prospect sa fiche secrète et la conversation, jamais les consignes de Nova", () => {
    const state = newState(scenarioById("hugo"), T0);
    const text = personaInput(state, data, scenarioById("hugo"));
    expect(text).toContain("1 500 €");
    expect(text).toContain("(tu as touché la question d'accueil « Combien coûte une app ? »)");
    expect(text).not.toContain("Règles absolues");
    expect(parsePersona({ messages: ["  ok  ", "", "merci"], fin: true })).toEqual({ messages: ["ok", "merci"], fin: true });
    expect(parsePersona('{"messages":["salut"],"fin":false}')).toEqual({ messages: ["salut"], fin: false });
  });
});
