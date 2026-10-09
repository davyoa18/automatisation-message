import { describe, expect, it } from "vitest";
import { advanceStage, computeScore, computeTemperature, deriveBudgetStatus, mergeFiche } from "../src/ai/scoring.js";
import { planDelivery, profileFor, totalDurationMs } from "../src/engine/pacing.js";
import { canSendAutomated, relanceFits } from "../src/engine/window.js";
import { parseWebhook, verifySignature } from "../src/instagram/webhook.js";
import { matchCommentRule, OPT_OUT } from "../src/engine/engine.js";
import { IgError } from "../src/instagram/client.js";
import { sanitizeButtons, sanitizeMessages, historyToTurns } from "../src/ai/agent.js";
import { ensureDisclosure, hasDisclosure, relanceRequest } from "../src/ai/conversation-context.js";
import { ficheAdvice, lenientFiche } from "../src/ai/tool-logic.js";
import { parseJsonLoose } from "../src/util/json.js";
import { sanitizeScreenHtml } from "../src/ebauche/generator.js";
import { parseBrief, parseScreens } from "../src/ebauche/screens.js";
import { suggestSlots } from "../src/util/slots.js";
import { hmacSha256Hex, seededRng, truncateBytes } from "../src/util/index.js";
import { loadConfig } from "../src/config.js";
import { loadStudio, render } from "../src/studio/knowledge.js";
import type { CommentRule } from "../src/db/repo/misc.js";
import type { Conversation, Message } from "../src/domain.js";

describe("fiche et score", () => {
  it("fusionne sans effacer et dédoublonne les listes", () => {
    const f = mergeFiche({ prenom: "Léa", fonctionnalites: ["Chat"] }, { fonctionnalites: ["chat", "paiement"], projet: "  App  ", prenom: "" });
    expect(f).toEqual({ prenom: "Léa", fonctionnalites: ["Chat", "paiement"], projet: "App" });
  });

  it("valide le budget à partir d'un montant ou d'une déclaration", () => {
    expect(deriveBudgetStatus({ budget_estime_eur: 8000 }, undefined, "inconnu", 5000)).toBe("ok");
    expect(deriveBudgetStatus({ budget_estime_eur: 1500 }, "oui", "inconnu", 5000)).toBe("insuffisant");
    expect(deriveBudgetStatus({}, "oui", "inconnu", 5000)).toBe("ok");
    expect(deriveBudgetStatus({}, "incertain", "inconnu", 5000)).toBe("a_confirmer");
    expect(deriveBudgetStatus({}, "incertain", "ok", 5000)).toBe("ok");
    expect(deriveBudgetStatus({}, undefined, "a_confirmer", 5000)).toBe("a_confirmer");
  });

  it("calcule un score cohérent et une température", () => {
    const hot = computeScore({ fiche: { description: "x", fonctionnalites: ["a", "b"], financement: ["levee_de_fonds"], echeance: "mars" }, budget: "ok", stage: "rdv_propose" });
    const cold = computeScore({ fiche: { description: "x", fonctionnalites: ["a", "b"] }, budget: "insuffisant", stage: "non_qualifie" });
    expect(hot).toBeGreaterThan(70);
    expect(cold).toBeLessThanOrEqual(15);
    expect(computeTemperature(hot, "ok", "rdv_propose")).toBe("brulant");
    expect(computeTemperature(cold, "insuffisant", "non_qualifie")).toBe("froid");
  });

  it("ne fait jamais reculer l'étape, sauf clôture explicite", () => {
    expect(advanceStage("ebauche", "decouverte")).toBe("ebauche");
    expect(advanceStage("decouverte", "qualifie")).toBe("qualifie");
    expect(advanceStage("rdv_propose", "perdu")).toBe("perdu");
    expect(advanceStage("desinscrit", "qualifie")).toBe("desinscrit");
    expect(advanceStage("non_qualifie", "qualifie")).toBe("qualifie");
  });
});

describe("rythme et fenêtre", () => {
  it("planifie des délais humains, et rien en mode instantané", () => {
    const rng = seededRng(1);
    const plan = planDelivery(["Salut !", "Une question : ton app servirait à quoi au quotidien ?"], profileFor("naturel", 8), rng, 8_000);
    expect(plan).toHaveLength(2);
    expect(plan[1]!.typingMs).toBeGreaterThan(plan[0]!.typingMs);
    expect(totalDurationMs(plan)).toBeLessThan(40_000);
    const instant = planDelivery(["a", "b"], profileFor("instantane", 8), rng);
    expect(totalDurationMs(instant)).toBe(0);
  });

  it("applique la règle des 24 h avec une marge", () => {
    const last = new Date("2026-10-12T10:00:00Z");
    expect(canSendAutomated(last, new Date("2026-10-13T09:00:00Z"))).toBe(true);
    expect(canSendAutomated(last, new Date("2026-10-13T09:55:00Z"))).toBe(false);
    expect(canSendAutomated(null, new Date())).toBe(false);
    expect(relanceFits(last, new Date("2026-10-13T07:00:00Z"))).toBe(true);
  });

  it("propose des créneaux en jours ouvrés, en dates absolues", () => {
    const slots = suggestSlots(new Date("2026-10-16T15:00:00Z")); // vendredi 17 h à Paris
    expect(slots.length).toBe(3);
    expect(slots.join(" ")).not.toMatch(/samedi|dimanche|demain|aujourd'hui/);
    expect(slots[0]).toBe("lundi 19 octobre à 10 h");
    expect(new Set(slots.map((s) => s.split(" à ")[1])).size).toBeGreaterThan(1);
  });
});

describe("webhooks Instagram", () => {
  it("vérifie la signature HMAC", () => {
    const body = JSON.stringify({ object: "instagram", entry: [] });
    const sig = `sha256=${hmacSha256Hex("s3cret", body)}`;
    expect(verifySignature(body, sig, "s3cret")).toBe(true);
    expect(verifySignature(body, sig, "autre")).toBe(false);
    expect(verifySignature(body, undefined, "s3cret")).toBe(false);
  });

  it("normalise messages, échos, réponses aux stories, boutons et commentaires", () => {
    const events = parseWebhook({
      object: "instagram",
      entry: [
        {
          id: "IG",
          time: 1791800000,
          messaging: [
            { sender: { id: "U" }, recipient: { id: "IG" }, timestamp: 1791800000000, message: { mid: "m1", text: "hello", reply_to: { story: { id: "s1", url: "https://x" } } } },
            { sender: { id: "IG" }, recipient: { id: "U" }, timestamp: 1791800001000, message: { mid: "m2", text: "salut", is_echo: true } },
            { sender: { id: "U" }, recipient: { id: "IG" }, timestamp: 1791800002000, postback: { mid: "m3", title: "Combien coûte une app ?", payload: "ICE:PRIX" } },
            { sender: { id: "U" }, recipient: { id: "IG" }, timestamp: 1791800003000, message: { mid: "m4", attachments: [{ type: "story_mention", payload: { url: "https://y" } }] } },
          ],
          changes: [{ field: "comments", value: { id: "c1", text: "APP", from: { id: "U", username: "u" }, media: { id: "M" } } }],
        },
      ],
    });
    expect(events.map((e) => e.kind)).toEqual(["message", "message", "postback", "message", "comment"]);
    const first = events[0]!;
    expect(first.kind === "message" && first.storyReply?.id).toBe("s1");
    expect(events[1]!.kind === "message" && events[1]!.isEcho).toBe(true);
    expect(events[3]!.kind === "message" && events[3]!.storyMention?.url).toBe("https://y");
  });

  it("reconnaît les mots-clés de commentaire en mot entier, sans accents ni casse", () => {
    const rules = [{ id: "r", media_id: null, keywords: ["APP", "MAQUETTE"], dm_text: null, public_reply: null, active: true, created_at: new Date() }] as CommentRule[];
    expect(matchCommentRule(rules, "je veux la maquette !", null)?.id).toBe("r");
    expect(matchCommentRule(rules, "App 🔥", "M1")?.id).toBe("r");
    expect(matchCommentRule(rules, "happy day", null)).toBeNull();
  });
});

describe("désinscription et erreurs Instagram", () => {
  it("ne désinscrit que sur une demande d'arrêt explicite et complète", () => {
    for (const t of ["STOP", "stop !", "Stop.", "stop svp", "Arrête de m'écrire", "arrêtez de m'écrire merci", "Ne m'écris plus", "laisse-moi tranquille !", "désinscris-moi", "unsubscribe"]) {
      expect(OPT_OUT.test(t), t).toBe(true);
    }
    for (const t of ["Arrête, c'est trop bien !", "Arrête j'adore 😍", "Stop motion c'est faisable ?", "Arrête !", "stop ou encore ?", "je veux arrêter mon abonnement salle de sport"]) {
      expect(OPT_OUT.test(t), t).toBe(false);
    }
  });

  it("réessaie les limites de débit même renvoyées en 400, abandonne les refus définitifs", () => {
    const rate = new IgError("(#4) Application request limit reached", 4, null, 400);
    expect(rate.isRateLimit && rate.isTransient && !rate.isPermanent).toBe(true);
    const window = new IgError("Outside of allowed window", 10, 2018278, 400);
    expect(window.isPermanent && !window.isTransient).toBe(true);
    const auth = new IgError("Invalid OAuth access token", 190, null, 400);
    expect(auth.isAuth && !auth.isPermanent).toBe(true);
    expect(new IgError("An unknown error occurred", 1, null, 500).isTransient).toBe(true);
  });
});

describe("sorties de l'IA", () => {
  it("nettoie les bulles et les boutons", () => {
    expect(sanitizeMessages(["**Salut** !", "", "a", "b", "c"])).toEqual(["Salut !", "a", "b"]);
    expect(sanitizeButtons(["Oui, carrément ça me va", "Non"])).toEqual(["Oui, carrément ça m…", "Non"]);
    expect(Buffer.byteLength(truncateBytes("é".repeat(800), 990))).toBeLessThanOrEqual(990);
  });

  it("reconnaît la présentation en IA sans se faire piéger par « j'ai »", () => {
    expect(hasDisclosure("Moi c'est Nova, l'IA de YD Studio")).toBe(true);
    expect(hasDisclosure("I'm Nova, YD Studio's AI assistant")).toBe(true);
    expect(hasDisclosure("Je suis une intelligence artificielle")).toBe(true);
    expect(hasDisclosure("Super, j'ai bien compris ton projet")).toBe(false);
    expect(hasDisclosure("Tu vas voir, ça vaut le détour, j'ai hâte")).toBe(false);
  });

  it("ajoute la présentation oubliée sans supprimer de bulle", () => {
    const vars = { ASSISTANT_NAME: "Nova", STUDIO_NAME: "YD Studio" };
    expect(ensureDisclosure(["Top projet !", "Il sert à quoi ?"], true, vars)).toEqual(["Moi c'est Nova, l'IA de YD Studio. L'équipe suit nos échanges.", "Top projet !", "Il sert à quoi ?"]);
    const three = ensureDisclosure(["a", "b", "c ?"], true, vars);
    expect(three).toHaveLength(3);
    expect(three[0]).toMatch(/^Moi c'est Nova, l'IA de YD Studio\. .* a$/);
    expect(three[2]).toBe("c ?");
    expect(ensureDisclosure(["Salut"], false, vars)).toEqual(["Salut"]);
  });

  it("lit le JSON même entouré de texte ou d'accolades parasites", () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonLoose("Voici :\n```json\n{\"a\":2}\n```")).toEqual({ a: 2 });
    expect(parseJsonLoose('Je réfléchis {pas du json} puis {"messages":["ok }"],"n":3}')).toEqual({ messages: ["ok }"], n: 3 });
    expect(() => parseJsonLoose("rien du tout")).toThrow();
  });

  it("garde les champs valides de la fiche et conseille l'étape suivante", () => {
    expect(lenientFiche({ prenom: "Léa", budget_estime_eur: "8000", stade_projet: "n'importe quoi", fonctionnalites: "pas une liste" })).toEqual({ prenom: "Léa", budget_estime_eur: 8000 });
    expect(ficheAdvice({ projet: "x", cible: "y", fonctionnalites: ["a", "b"] }, "ok", false).suite).toMatch(/lancer_ebauche/);
    expect(ficheAdvice({}, "inconnu", false).manquants).toContain("le budget");
  });

  it("construit la demande de relance avec la fiche et la conversation", () => {
    const text = relanceRequest({
      numero: 2,
      total: 2,
      now: new Date("2026-10-12T08:00:00Z"),
      lead: { stage: "decouverte", budget_status: "inconnu", score: 7, fiche: { prenom: "Léa" }, summary: null },
      contact: { username: "lea", name: null },
      history: [{ direction: "entrant", author: "prospect", text: "Salut", status: "recu", created_at: "2026-10-11T18:00:00Z" }],
      assistantName: "Nova",
      timezone: "Europe/Paris",
    });
    expect(text).toContain("Relance n°2 sur 2 (la dernière).");
    expect(text).toContain("Prospect : Salut");
    expect(text).toContain('"prenom":"Léa"');
  });

  it("neutralise aussi les formulaires, imports et liens data: non image", () => {
    const html = sanitizeScreenHtml(`<style>@import "https://evil/x.css"; .a{color:red}</style><form action="https://evil/post"><button formaction="https://evil">Go</button></form><a href="data:text/html,<b>x</b>">lien</a><img src="data:image/png;base64,AAA">`);
    expect(html).not.toMatch(/evil|<form|formaction|data:text/);
    expect(html).toContain("data:image/png");
    expect(html).toContain(".a{color:red}");
  });

  it("lit un brief et des écrans d'ébauche en tolérant les champs manquants", () => {
    expect(parseBrief({ nom_app: "X", promesse: "" })).toBeNull();
    const brief = parseBrief({ nom_app: "Maternia", promesse: "Suivi", ecrans: [{ titre: "Accueil", role: "r" }, "bruit"], direction_artistique: { couleurs: ["#fff", 3] } });
    expect(brief?.ecrans).toEqual([{ titre: "Accueil", role: "r" }]);
    expect(brief?.direction_artistique).toEqual({ ambiance: "", couleurs: ["#fff"], typographie: "" });
    expect(brief?.fonctionnalites_mvp).toEqual([]);
    const screens = parseScreens({ ecrans: [{ titre: "A", html: "<div onclick='x()'>a</div>" }, { titre: "B" }, { titre: "C", html: "c" }, { titre: "D", html: "d" }, { titre: "E", html: "e" }] });
    expect(screens.map((e) => e.titre)).toEqual(["A", "C", "D"]);
    expect(screens[0]!.html).toBe("<div>a</div>");
  });

  it("neutralise le HTML des maquettes", () => {
    const html = sanitizeScreenHtml(`<script>alert(1)</script><img src="https://evil/x.png" onerror="x()"><div style="background:url(https://evil/y)">ok</div>`);
    expect(html).not.toMatch(/script|evil|onerror/);
    expect(html).toContain("ok");
  });

  it("transforme l'historique en tours alternés commençant par l'utilisateur", () => {
    const conv = { source: "commentaire" } as Conversation;
    const m = (direction: "entrant" | "sortant", author: Message["author"], text: string, kind: Message["kind"] = "texte") => ({ direction, author, text, kind, payload: {}, status: "envoye" }) as unknown as Message;
    const turns = historyToTurns([m("sortant", "ia", "Hello"), m("entrant", "prospect", "Salut"), m("entrant", "prospect", "J'ai une idée"), m("sortant", "humain", "Top")], conv);
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(turns[2]!.content).toBe("Salut\nJ'ai une idée");
    expect(turns[3]!.content).toBe("[Équipe] Top");
  });
});

describe("base de connaissances", () => {
  it("remplace toutes les variables des prompts", () => {
    const studio = loadStudio(loadConfig({} as NodeJS.ProcessEnv));
    for (const name of ["conversation", "relance", "analyse", "ebauche-brief", "ebauche-ecrans", "prospection", "accroche"]) {
      const p = studio.prompt(name);
      expect(p, name).not.toMatch(/\{\{[A-Z_]+\}\}/);
    }
    expect(studio.prompt("conversation")).toContain("5 000 €");
    expect(render("{{A}} {{B}}", { A: "x" })).toBe("x {{B}}");
  });
});
