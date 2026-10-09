/**
 * Le cœur du Labo, sans DOM : l'état d'une conversation de test, les outils de Nova exécutés avec
 * les mêmes règles que le moteur (src/ai/tools.ts), les demandes envoyées au modèle et la lecture
 * de ses réponses. Testé dans Node (tests/labo.test.ts) et utilisé dans la page par labo/app.ts.
 *
 * Différence assumée avec la production : la page ne peut pas faire tourner la boucle d'outils
 * du moteur à chaque tour sans multiplier les appels. Nova écrit donc ses appels d'outils dans sa
 * réponse JSON (champ `outils`), le Labo les exécute ensuite, et repose la question une fois si un
 * outil a refusé l'action, comme le ferait la boucle de production.
 */
import { STAGE_LABELS, type BudgetStatus, type Fiche, type Source, type Stage, type Temperature } from "../src/domain.js";
import { advanceStage, computeScore, computeTemperature, deriveBudgetStatus, mergeFiche, stageFromFiche } from "../src/ai/scoring.js";
import { CONSIGNES, clotureStage, ficheAdvice, lenientFiche, parseRdvDate } from "../src/ai/tool-logic.js";
import {
  analyseRequest,
  buildContext,
  ensureDisclosure,
  historyToTurns,
  relanceRequest,
  sanitizeButtons,
  sanitizeMessages,
  type HistoryMessage,
  type TranscriptMessage,
  type Turn,
} from "../src/ai/conversation-context.js";
import { planDelivery, profileFor, totalDurationMs, type DeliveryStep } from "../src/engine/pacing.js";
import { relanceFits, windowRemainingMs } from "../src/engine/window.js";
import { suggestSlots } from "../src/util/slots.js";
import { parseJsonLoose } from "../src/util/json.js";
import { formatParis, type Rng } from "../src/util/pure.js";
import type { Scenario } from "./personas.js";

/* ------------------------------ Données figées au build ------------------------------ */

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** Ce que scripts/build-labo.ts injecte dans la page : prompts rendus, outils, réglages. */
export interface LaboData {
  builtAt: string;
  commit: string;
  vars: Record<string, string>;
  budgetMin: number;
  timezone: string;
  bookingUrl: string;
  prompts: { conversation: string; relance: string; analyse: string };
  tools: ToolDefinition[];
  relanceDelaysMs: number[];
  pacing: { profile: "naturel" | "rapide" | "instantane"; debounceSeconds: number };
  aiPauseHours: number;
  models: { conversation: string; analyse: string; ebauche: string };
}

/* ------------------------------ Modèles proposés ------------------------------ */

export type ModelChoiceId = "sonnet" | "opus" | "rapide";

export interface ModelChoice {
  id: ModelChoiceId;
  label: string;
  detail: string;
  model?: string;
  modelTier: "default" | "complex" | "quick";
  effort?: "low" | "medium" | "high";
}

export const MODEL_CHOICES: Record<ModelChoiceId, ModelChoice> = {
  sonnet: { id: "sonnet", label: "Sonnet 5.5", detail: "Le modèle de production", model: "claude-sonnet-5-5", modelTier: "default", effort: "low" },
  opus: { id: "opus", label: "Opus 5.5", detail: "Pour comparer", model: "claude-opus-5-5", modelTier: "complex", effort: "low" },
  rapide: { id: "rapide", label: "Rapide", detail: "Le plus économique", modelTier: "quick" },
};

/** Libellé de ce qui a réellement répondu, d'après le résultat de l'appel. */
export function answeredBy(choice: ModelChoice, modelApplied: string | undefined, tierApplied: string | undefined): string {
  if (choice.model && modelApplied === choice.model) return choice.label;
  if (choice.model) return `${choice.label} indisponible, modèle ${tierLabel(tierApplied)}`;
  return `modèle ${tierLabel(tierApplied ?? choice.modelTier)}`;
}

function tierLabel(tier: string | undefined): string {
  return tier === "complex" ? "le plus avancé" : tier === "quick" ? "rapide" : "standard";
}

/* ------------------------------ État d'un essai ------------------------------ */

export interface LaboMessage {
  id: string;
  author: "prospect" | "nova";
  kind: "texte" | "postback" | "commentaire";
  text: string;
  at: number;
  status: "envoye" | "annule";
  replyId?: string;
}

export interface ToolCall {
  nom: string;
  arguments: Record<string, unknown>;
  resultat: Record<string, unknown>;
}

export interface NovaReply {
  id: string;
  kind: "reponse" | "relance";
  at: number;
  modelChoice: ModelChoiceId;
  modelLabel: string;
  durationMs: number;
  messages: string[];
  boutons: string[];
  relanceUtile: boolean;
  noteEquipe: string;
  outils: ToolCall[];
  plan: DeliveryStep[];
  formatOk: boolean;
  corrected: boolean;
  context: string;
  relance?: { numero: number; total: number; envoyer: boolean; raison: string };
}

export type EventTone = "info" | "ok" | "warn" | "hot";

export interface LaboEvent {
  id: string;
  at: number;
  type: string;
  label: string;
  detail?: string;
  tone: EventTone;
}

export interface LaboNotification {
  id: string;
  at: number;
  titre: string;
  corps: string;
  urgent: boolean;
}

export interface LaboAnalyse {
  at: number;
  resume: string;
  temperature: Temperature;
  prochaine_action: string;
  relance_manuelle: string;
  signaux: string[];
  risques: string[];
}

export interface LaboLead {
  stage: Stage;
  budget_status: BudgetStatus;
  score: number;
  temperature: Temperature;
  fiche: Fiche;
  rdv_at: string | null;
  rdv_note: string | null;
  next_action: string | null;
  summary: string | null;
  ebauche_id: string | null;
}

export interface LaboState {
  v: 1;
  scenarioId: string;
  /** Décalage de l'horloge simulée (silence du prospect) par rapport à l'heure réelle. */
  clockOffsetMs: number;
  conversation: { source: Source; source_ref: string | null; channel: "bac_a_sable" };
  contact: {
    username: string | null;
    name: string | null;
    follower_count: number | null;
    is_verified: boolean | null;
    follows_us: boolean | null;
    email: string | null;
    opted_out: boolean;
  };
  lead: LaboLead;
  ebauche: { createdAt: number; readyAt: number; resume: string; fonctionnalites: string[]; ambiance: string } | null;
  aiPausedUntil: number | null;
  lastInboundAt: number | null;
  messages: LaboMessage[];
  replies: NovaReply[];
  events: LaboEvent[];
  notifications: LaboNotification[];
  analyse: LaboAnalyse | null;
  seq: number;
}

/** Délai de préparation simulé d'une ébauche (en production : 2 à 3 minutes avec Opus). */
export const EBAUCHE_READY_MS = 3 * 60_000;
const TERMINAL: ReadonlySet<Stage> = new Set(["perdu", "non_qualifie", "desinscrit", "gagne", "rdv_pris"]);

function nextId(state: LaboState, prefix: string): string {
  state.seq += 1;
  return `${prefix}${state.seq}`;
}

export function newState(scenario: Scenario, now: number): LaboState {
  const state: LaboState = {
    v: 1,
    scenarioId: scenario.id,
    clockOffsetMs: 0,
    conversation: { source: scenario.source, source_ref: scenario.sourceRef, channel: "bac_a_sable" },
    contact: {
      username: scenario.profil.username,
      name: scenario.profil.name,
      follower_count: scenario.profil.follower_count,
      is_verified: false,
      follows_us: scenario.profil.follows_us,
      email: null,
      opted_out: false,
    },
    lead: {
      stage: "nouveau",
      budget_status: "inconnu",
      score: 0,
      temperature: "froid",
      fiche: {},
      rdv_at: null,
      rdv_note: null,
      next_action: null,
      summary: null,
      ebauche_id: null,
    },
    ebauche: null,
    aiPausedUntil: null,
    lastInboundAt: null,
    messages: [],
    replies: [],
    events: [],
    notifications: [],
    analyse: null,
    seq: 0,
  };
  if (scenario.ouverture.text) addProspectMessage(state, scenario.ouverture.text, now, scenario.ouverture.kind);
  return state;
}

export function cloneState(state: LaboState): LaboState {
  return JSON.parse(JSON.stringify(state)) as LaboState;
}

export function addProspectMessage(state: LaboState, text: string, now: number, kind: LaboMessage["kind"] = "texte"): LaboMessage {
  const msg: LaboMessage = { id: nextId(state, "m"), author: "prospect", kind, text: text.trim(), at: now, status: "envoye" };
  state.messages.push(msg);
  state.lastInboundAt = now;
  return msg;
}

function event(state: LaboState, now: number, type: string, label: string, tone: EventTone, detail?: string) {
  state.events.push({ id: nextId(state, "e"), at: now, type, label, tone, ...(detail ? { detail } : {}) });
}

function notify(state: LaboState, now: number, titre: string, corps: string, urgent = false) {
  state.notifications.push({ id: nextId(state, "n"), at: now, titre: `[Labo] ${titre}`, corps, urgent });
}

export function sentMessages(state: LaboState): LaboMessage[] {
  return state.messages.filter((m) => m.status === "envoye");
}

export function isFirstAiMessage(state: LaboState): boolean {
  return !state.messages.some((m) => m.author === "nova" && m.status === "envoye");
}

/** C'est à Nova de répondre : le dernier message envoyé vient du prospect. */
export function awaitingNova(state: LaboState): boolean {
  const last = sentMessages(state).at(-1);
  return !!last && last.author === "prospect";
}

export function ebaucheStatus(state: LaboState, now: number): "en_preparation" | "prete" | null {
  if (!state.ebauche) return null;
  return now >= state.ebauche.readyAt ? "prete" : "en_preparation";
}

export function windowInfo(state: LaboState, now: number): { remainingMs: number; open: boolean } {
  const last = state.lastInboundAt ? new Date(state.lastInboundAt) : null;
  const remainingMs = windowRemainingMs(last, new Date(now));
  return { remainingMs, open: remainingMs > 0 };
}

function historyMessages(state: LaboState): (HistoryMessage & TranscriptMessage)[] {
  return sentMessages(state).map((m) =>
    m.author === "prospect"
      ? { direction: "entrant", author: "prospect", kind: m.kind, text: m.text, payload: m.kind === "postback" ? { title: m.text } : {}, status: "recu", created_at: m.at }
      : { direction: "sortant", author: "ia", kind: "texte", text: m.text, payload: {}, status: "envoye", created_at: m.at },
  );
}

/* ------------------------------ Outils ------------------------------ */

function who(state: LaboState): string {
  const handle = state.contact.username ? `@${state.contact.username}` : state.contact.name ?? "un prospect";
  return state.lead.fiche.prenom ? `${state.lead.fiche.prenom} (${handle})` : handle;
}

function rescore(state: LaboState, stage: Stage) {
  const budget = state.lead.budget_status;
  const score = computeScore({ fiche: state.lead.fiche, budget, stage, hasEmail: !!state.contact.email });
  state.lead.stage = stage;
  state.lead.score = score;
  state.lead.temperature = computeTemperature(score, budget, stage);
}

const BUDGET_LABELS: Record<BudgetStatus, string> = { inconnu: "inconnu", a_confirmer: "à confirmer", ok: "validé", insuffisant: "insuffisant" };

export interface ToolOptions {
  now: number;
  bookingUrl: string;
}

/** Exécute un outil de Nova sur l'état du Labo, avec les mêmes règles et consignes que src/ai/tools.ts. */
export function runTool(state: LaboState, data: LaboData, name: string, rawInput: unknown, opts: ToolOptions): Record<string, unknown> {
  const input = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<string, unknown>;
  const min = data.budgetMin;
  const now = opts.now;
  const duree = data.vars.DUREE_APPEL ?? "10";

  switch (name) {
    case "maj_fiche": {
      const patch = lenientFiche(input);
      const before = state.lead.budget_status;
      const fiche = mergeFiche(state.lead.fiche, patch);
      const budget = deriveBudgetStatus(fiche, patch.budget_suffisant, before, min);
      if (patch.email) state.contact.email = patch.email;
      state.lead.fiche = fiche;
      state.lead.budget_status = budget;
      rescore(state, advanceStage(state.lead.stage, stageFromFiche(fiche, budget)));
      const champs = Object.keys(patch).filter((k) => k !== "budget_suffisant");
      if (champs.length) event(state, now, "fiche", "Fiche mise à jour", "info", champs.join(", "));
      if (budget !== before) {
        if (budget === "ok") {
          event(state, now, "budget_valide", "Budget validé", "ok", fiche.budget_declare ?? (fiche.budget_estime_eur ? `${fiche.budget_estime_eur} €` : undefined));
          notify(state, now, `Budget validé : ${who(state)}`, `${fiche.projet ?? "Projet en cours de description"}\nBudget : ${fiche.budget_declare ?? fiche.budget_estime_eur ?? "confirmé ≥ " + min + " €"}`);
        } else if (budget === "insuffisant") {
          event(state, now, "budget_insuffisant", "Budget insuffisant", "warn", fiche.budget_declare);
        } else {
          event(state, now, "budget", `Budget ${BUDGET_LABELS[budget]}`, "info");
        }
      }
      const { manquants, suite } = ficheAdvice(fiche, budget, !!state.lead.ebauche_id);
      return { ok: true, budget, etape: state.lead.stage, manquants, suite };
    }

    case "lancer_ebauche": {
      if (state.lead.budget_status !== "ok") {
        event(state, now, "refus", "Ébauche refusée : budget non validé", "warn");
        return { refuse: true, raison: CONSIGNES.ebaucheRefusee(min) };
      }
      if (state.lead.ebauche_id && state.ebauche) {
        return { statut: "deja_lancee", prete: ebaucheStatus(state, now) === "prete", consigne: CONSIGNES.ebaucheDejaLancee };
      }
      const resume = String(input.resume ?? "").slice(0, 2000);
      const fonctionnalites = Array.isArray(input.fonctionnalites_cles) ? input.fonctionnalites_cles.map(String).slice(0, 10) : [];
      const ambiance = String(input.ambiance_visuelle ?? "");
      state.ebauche = { createdAt: now, readyAt: now + EBAUCHE_READY_MS, resume, fonctionnalites, ambiance };
      state.lead.ebauche_id = nextId(state, "eb");
      rescore(state, advanceStage(state.lead.stage, "ebauche"));
      event(state, now, "ebauche_lancee", "Ébauche lancée", "ok", resume);
      notify(state, now, `Ébauche lancée : ${who(state)}`, `${resume}\nFonctionnalités : ${fonctionnalites.join(", ")}`);
      return { statut: "en_preparation", consigne: CONSIGNES.ebaucheLancee(duree) };
    }

    case "proposer_rdv": {
      if (state.lead.budget_status !== "ok") {
        event(state, now, "refus", "Appel refusé : budget non validé", "warn");
        return { refuse: true, raison: CONSIGNES.rdvRefuse(min) };
      }
      const creneaux = suggestSlots(new Date(now), data.timezone);
      rescore(state, advanceStage(state.lead.stage, "rdv_propose"));
      event(state, now, "rdv_propose", "Appel proposé", "ok", creneaux.join(" · "));
      const lien = opts.bookingUrl || null;
      return { lien, creneaux, consigne: lien ? CONSIGNES.rdvAvecLien : CONSIGNES.rdvSansLien };
    }

    case "noter_rdv": {
      const quand = String(input.quand ?? "").trim();
      const email = String(input.email ?? "").trim();
      const remarque = String(input.remarque ?? "").trim();
      const rdvAt = parseRdvDate(quand, new Date(now));
      if (email) {
        state.contact.email = email;
        state.lead.fiche = mergeFiche(state.lead.fiche, { email });
      }
      state.lead.rdv_at = rdvAt ? rdvAt.toISOString() : null;
      state.lead.rdv_note = `Demandé par le prospect : ${quand}${remarque ? ` (${remarque})` : ""} — à confirmer par l'équipe`;
      state.lead.next_action = `Confirmer l'appel (${quand}) et envoyer l'invitation${email ? ` à ${email}` : ""}`;
      rescore(state, advanceStage(state.lead.stage, "rdv_pris"));
      event(state, now, "rdv_pris", "Rendez-vous demandé", "hot", rdvAt ? formatParis(rdvAt, data.timezone) : quand);
      notify(
        state,
        now,
        `RDV demandé : ${who(state)}`,
        `Créneau : ${quand}${email ? `\nEmail : ${email}` : "\nEmail : à demander"}\nProjet : ${state.lead.fiche.projet ?? "—"}\nÀ confirmer et inviter.`,
        true,
      );
      return { ok: true, consigne: CONSIGNES.rdvNote(!!email) };
    }

    case "passer_la_main": {
      const raison = String(input.raison ?? "Demande d'intervention humaine");
      const urgence = input.urgence === "haute" ? "haute" : "normale";
      state.aiPausedUntil = now + data.aiPauseHours * 3_600_000;
      state.lead.next_action = `Répondre à la main : ${raison}`;
      event(state, now, "relai_humain", "Relais à un humain", "hot", raison);
      notify(state, now, `Un humain doit répondre : ${who(state)}`, raison, urgence === "haute");
      return { ok: true, consigne: CONSIGNES.relaiHumain };
    }

    case "clore_conversation": {
      const motif = String(input.motif ?? "autre");
      const recontacter = input.recontacter === true;
      const quand = String(input.quand ?? "").trim();
      rescore(state, advanceStage(state.lead.stage, clotureStage(motif)));
      state.lead.next_action = recontacter ? `Recontacter ${quand || "plus tard"} (${motif})` : null;
      event(state, now, "cloture", "Conversation close", "warn", `${motif}${recontacter ? ` · à recontacter ${quand}` : ""}`);
      return { ok: true };
    }

    case "desinscrire": {
      const effacer = input.effacer_donnees === true;
      state.contact.opted_out = true;
      rescore(state, "desinscrit");
      state.lead.next_action = effacer ? "Effacer les données (demande du prospect)" : null;
      event(state, now, "desinscription", effacer ? "Désinscription et effacement demandés" : "Désinscription", "warn");
      if (effacer) notify(state, now, `Demande d'effacement : ${who(state)}`, "Le prospect demande la suppression de ses données : bouton « Effacer » dans le cockpit.", true);
      return { ok: true, consigne: CONSIGNES.desinscription };
    }

    default:
      return { erreur: CONSIGNES.outilInconnu(name) };
  }
}

/* ------------------------------ Demande à Nova ------------------------------ */

export interface SampleTurn {
  role: "user" | "assistant";
  content: string;
}

export interface NovaRequest {
  input: SampleTurn[];
  context: string;
  firstMessage: boolean;
}

const FORMAT_REMINDER = "[Format] Réponds uniquement avec l'objet JSON du mode labo : outils, messages, boutons, relance_utile, note_equipe.";

/** Les consignes propres au Labo, ajoutées après le prompt maître de production. */
export function laboAdapter(state: LaboState, data: LaboData, opts: ToolOptions): string {
  const duree = data.vars.DUREE_APPEL ?? "10";
  const creneaux = suggestSlots(new Date(opts.now), data.timezone);
  const tools = data.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
  return [
    "# Mode labo",
    "",
    "Cette conversation a lieu dans le labo de test de l'équipe : comporte-toi exactement comme avec un vrai prospect, avec les mêmes règles.",
    "",
    "Dans le labo, tu n'appelles pas tes outils directement : tu écris dans le champ `outils` de ta réponse les appels que tu ferais, dans l'ordre, avec leurs arguments. Le labo les exécute ensuite comme le moteur de production. Tu ne vois pas leurs résultats avant d'écrire ; voici ce qu'ils renverront :",
    "- `maj_fiche` : enregistre les informations nouvelles. La fiche du contexte est l'état d'avant le dernier message du prospect.",
    `- \`lancer_ebauche\` : refusé si le budget n'est pas validé à ce moment-là (ton appel à \`maj_fiche\` placé avant peut le valider). Sinon, consigne : « ${CONSIGNES.ebaucheLancee(duree)} »`,
    `- \`proposer_rdv\` : refusé si le budget n'est pas validé. Sinon : lien de réservation ${opts.bookingUrl ? opts.bookingUrl : "aucun"} ; créneaux : ${creneaux.join(" ; ")}. Consigne : « ${opts.bookingUrl ? CONSIGNES.rdvAvecLien : CONSIGNES.rdvSansLien} »`,
    `- \`noter_rdv\` : consigne « ${CONSIGNES.rdvNote(true)} » (si tu n'as pas l'email, demande-le).`,
    `- \`passer_la_main\` : consigne « ${CONSIGNES.relaiHumain} »`,
    `- \`desinscrire\` : consigne « ${CONSIGNES.desinscription} »`,
    "- `clore_conversation` : aucune consigne.",
    "",
    "Définitions des outils :",
    "```json",
    JSON.stringify(tools),
    "```",
    "",
    "# Ta réponse dans le labo",
    "",
    "Un seul objet JSON, sans texte autour, avec en plus le champ `outils` (liste vide si aucun outil) :",
    '{"outils": [{"nom": "maj_fiche", "arguments": {"prenom": "…"}}], "messages": ["…"], "boutons": [], "relance_utile": true, "note_equipe": ""}',
  ].join("\n");
}

/** Construit la demande envoyée au modèle : mêmes tours et même contexte que le moteur de production. */
export function novaRequest(state: LaboState, data: LaboData, opts: ToolOptions): NovaRequest {
  const firstMessage = isFirstAiMessage(state);
  const turns: Turn[] = historyToTurns(historyMessages(state), state.conversation);
  if (!turns.length || turns[turns.length - 1]!.role !== "user") {
    turns.push({ role: "user", content: "[Aucun nouveau message : relis la conversation et réponds seulement si c'est utile.]" });
  }
  const status = ebaucheStatus(state, opts.now);
  const context = buildContext(
    {
      conversation: state.conversation,
      contact: state.contact,
      lead: { ...state.lead, rdv_at: state.lead.rdv_at ? new Date(state.lead.rdv_at) : null },
      ebauche: status ? { status: status === "prete" ? "prete" : "en_cours" } : null,
    },
    { now: new Date(opts.now), timezone: data.timezone, bookingUrl: opts.bookingUrl },
    firstMessage,
  );
  const standing = `${data.prompts.conversation}\n\n${laboAdapter(state, data, opts)}`;
  const last = turns[turns.length - 1]!;
  const input: SampleTurn[] = [
    { role: "user", content: standing },
    ...turns.slice(0, -1),
    { role: "user", content: `${last.content}\n\n[Note interne, invisible pour le prospect]\n${context}\n\n${FORMAT_REMINDER}` },
  ];
  return { input, context, firstMessage };
}

export interface ParsedReply {
  formatOk: boolean;
  outils: { nom: string; arguments: Record<string, unknown> }[];
  messages: string[];
  boutons: string[];
  relanceUtile: boolean;
  noteEquipe: string;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string" || typeof x === "number").map(String) : typeof v === "string" ? [v] : []);

/** Lit la réponse de Nova ; si le JSON manque, le texte brut devient la réponse (signalée comme hors format). */
export function parseNovaReply(text: string): ParsedReply {
  try {
    const raw = parseJsonLoose(text);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("pas un objet");
    const o = raw as Record<string, unknown>;
    if (!("messages" in o) && !("outils" in o)) throw new Error("champs absents");
    const outils = (Array.isArray(o.outils) ? o.outils : [])
      .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
      .map((t) => ({
        nom: String(t.nom ?? t.name ?? ""),
        arguments: (t.arguments ?? t.input ?? t.args ?? {}) as Record<string, unknown>,
      }))
      .filter((t) => t.nom);
    return {
      formatOk: true,
      outils,
      messages: strings(o.messages),
      boutons: strings(o.boutons),
      relanceUtile: o.relance_utile === true,
      noteEquipe: typeof o.note_equipe === "string" ? o.note_equipe : "",
    };
  } catch {
    const messages = text
      .split(/\n{2,}/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 3);
    return { formatOk: false, outils: [], messages, boutons: [], relanceUtile: false, noteEquipe: "" };
  }
}

/** Exécute les appels d'outils d'une réponse ; indique si l'un d'eux a refusé l'action. */
export function applyTools(state: LaboState, data: LaboData, parsed: ParsedReply, opts: ToolOptions): { calls: ToolCall[]; refused: boolean } {
  const calls: ToolCall[] = [];
  let refused = false;
  for (const t of parsed.outils.slice(0, 8)) {
    const resultat = runTool(state, data, t.nom, t.arguments, opts);
    if (resultat.refuse === true || "erreur" in resultat) refused = true;
    calls.push({ nom: t.nom, arguments: t.arguments, resultat });
  }
  return { calls, refused };
}

/** Deuxième tour après un refus d'outil : Nova voit les résultats et réécrit sa réponse. */
export function correctionRequest(request: NovaRequest, rawReply: string, calls: ToolCall[]): SampleTurn[] {
  const results = calls.map((c) => ({ outil: c.nom, resultat: c.resultat }));
  return [
    ...request.input,
    { role: "assistant", content: rawReply },
    {
      role: "user",
      content: [
        "[Résultats de tes outils]",
        JSON.stringify(results),
        "",
        "Au moins un appel a été refusé. Réécris ta réponse au prospect en tenant compte de ces résultats. Les outils acceptés sont déjà exécutés : ne les rappelle pas.",
        FORMAT_REMINDER,
      ].join("\n"),
    },
  ];
}

export interface ReplyMeta {
  now: number;
  modelChoice: ModelChoiceId;
  modelLabel: string;
  durationMs: number;
  corrected: boolean;
  context: string;
  firstMessage: boolean;
  rng: Rng;
}

/** Plan d'envoi de production : regroupement, lecture, frappe, pauses entre bulles. */
export function deliveryPlan(messages: string[], data: LaboData, generationMs: number, rng: Rng): DeliveryStep[] {
  const profile = profileFor(data.pacing.profile, data.pacing.debounceSeconds);
  return planDelivery(messages, profile, rng, profile.debounceMs + generationMs);
}

/** Enregistre la réponse de Nova (après outils) et ses bulles dans l'état. */
export function recordReply(state: LaboState, data: LaboData, parsed: ParsedReply, calls: ToolCall[], meta: ReplyMeta): NovaReply {
  const messages = ensureDisclosure(sanitizeMessages(parsed.messages), meta.firstMessage, data.vars);
  const reply: NovaReply = {
    id: nextId(state, "r"),
    kind: "reponse",
    at: meta.now,
    modelChoice: meta.modelChoice,
    modelLabel: meta.modelLabel,
    durationMs: meta.durationMs,
    messages,
    boutons: sanitizeButtons(parsed.boutons),
    relanceUtile: parsed.relanceUtile,
    noteEquipe: parsed.noteEquipe.trim(),
    outils: calls,
    plan: deliveryPlan(messages, data, meta.durationMs, meta.rng),
    formatOk: parsed.formatOk,
    corrected: meta.corrected,
    context: meta.context,
  };
  state.replies.push(reply);
  messages.forEach((text, i) => {
    state.messages.push({ id: nextId(state, "m"), author: "nova", kind: "texte", text, at: meta.now + i, status: "envoye", replyId: reply.id });
  });
  if (reply.noteEquipe) notify(state, meta.now, `Note de Nova : ${who(state)}`, reply.noteEquipe);
  return reply;
}

/** Annule les bulles pas encore « envoyées » d'une réponse (le prospect a écrit entre-temps). */
export function cancelBubbles(state: LaboState, replyId: string, fromIndex: number): number {
  let n = 0;
  state.messages
    .filter((m) => m.replyId === replyId)
    .forEach((m, i) => {
      if (i >= fromIndex && m.status === "envoye") {
        m.status = "annule";
        n++;
      }
    });
  return n;
}

/** Délai total avant la première bulle en production, à partir du message du prospect. */
export function firstBubbleDelayMs(reply: NovaReply, data: LaboData): number {
  const first = reply.plan[0];
  if (!first) return 0;
  return data.pacing.debounceSeconds * 1000 + reply.durationMs + first.waitBeforeTypingMs + first.typingMs;
}

export { totalDurationMs };

/* ------------------------------ Pause IA, désinscription ------------------------------ */

/** Pourquoi Nova ne répondrait pas du tout en production (sinon null). */
export function silenceReason(state: LaboState, now: number): string | null {
  if (state.contact.opted_out) return "Désinscrit : le moteur n'envoie plus aucun message automatique.";
  if (state.aiPausedUntil && state.aiPausedUntil > now) return "IA en pause : un humain a pris le relais, l'équipe est alertée.";
  return null;
}

export function resumeAi(state: LaboState, now: number): void {
  state.aiPausedUntil = null;
  event(state, now, "reprise_ia", "IA réactivée par l'équipe", "info");
}

/* ------------------------------ Relances ------------------------------ */

export type RelanceStatus = { possible: true; numero: number; total: number; at: number } | { possible: false; raison: string };

/** Ce que ferait le moteur si le prospect ne répond plus : mêmes conditions que jobRelancer. */
export function relanceStatus(state: LaboState, data: LaboData, now: number): RelanceStatus {
  const total = data.relanceDelaysMs.length;
  const no = (raison: string): RelanceStatus => ({ possible: false, raison });
  if (!total) return no("Aucune relance n'est configurée.");
  const sent = sentMessages(state);
  if (!sent.some((m) => m.author === "nova")) return no("Nova n'a pas encore écrit.");
  if (sent.at(-1)?.author === "prospect") return no("Le prospect attend une réponse : pas de relance.");
  if (state.contact.opted_out) return no("Désinscrit : plus aucun message automatique.");
  if (TERMINAL.has(state.lead.stage)) return no(`Étape « ${STAGE_LABELS[state.lead.stage]} » : pas de relance.`);
  if (state.lead.budget_status === "insuffisant") return no("Budget insuffisant : pas de relance.");
  if (state.aiPausedUntil && state.aiPausedUntil > now) return no("IA en pause : c'est l'équipe qui reprend la main.");
  const since = state.lastInboundAt ?? 0;
  const relances = state.replies.filter((r) => r.kind === "relance" && r.at > since);
  const lastAnswer = [...state.replies].reverse().find((r) => r.kind === "reponse");
  let numero: number;
  let at: number;
  if (!relances.length) {
    if (!lastAnswer) return no("Nova n'a pas encore répondu.");
    if (!lastAnswer.relanceUtile) return no("Nova a jugé qu'une relance ne serait pas utile après sa dernière réponse.");
    numero = 1;
    at = lastAnswer.at + data.relanceDelaysMs[0]!;
  } else {
    const lastRelance = relances[relances.length - 1]!;
    if (!lastRelance.relance?.envoyer) return no(`Nova a renoncé à relancer : ${lastRelance.relance?.raison ?? "relance jugée insistante"}.`);
    if (relances.length >= total) return no(`Les ${total} relances ont été envoyées : la suite revient à l'équipe.`);
    numero = relances.length + 1;
    const delay = Math.max(60_000, data.relanceDelaysMs[numero - 1]! - data.relanceDelaysMs[numero - 2]!);
    at = lastRelance.at + delay;
  }
  if (!relanceFits(state.lastInboundAt ? new Date(state.lastInboundAt) : null, new Date(at))) {
    return no("La relance tomberait hors de la fenêtre de 24 h d'Instagram.");
  }
  return { possible: true, numero, total, at };
}

/** La demande de relance (prompt « relance » de production + la conversation). */
export function relanceInput(state: LaboState, data: LaboData, numero: number, total: number, now: number): string {
  const request = relanceRequest({
    numero,
    total,
    now: new Date(now),
    lead: state.lead,
    contact: state.contact,
    history: historyMessages(state),
    assistantName: data.vars.ASSISTANT_NAME ?? "Nova",
    timezone: data.timezone,
  });
  return `${data.prompts.relance}\n\n---\n\n${request}\n\nRéponds uniquement avec l'objet JSON : envoyer, message, raison.`;
}

export function parseRelance(text: string): { envoyer: boolean; message: string; raison: string } {
  try {
    const o = parseJsonLoose(text) as Record<string, unknown>;
    const message = typeof o.message === "string" ? o.message.trim() : "";
    return { envoyer: o.envoyer === true && !!message, message, raison: typeof o.raison === "string" ? o.raison : "" };
  } catch {
    return { envoyer: false, message: "", raison: "Réponse illisible : en production, aucune relance ne partirait." };
  }
}

/** Avance l'horloge simulée jusqu'à la relance et l'enregistre. */
export function recordRelance(
  state: LaboState,
  data: LaboData,
  status: { numero: number; total: number; at: number },
  draft: { envoyer: boolean; message: string; raison: string },
  meta: Omit<ReplyMeta, "corrected" | "context" | "firstMessage" | "now">,
): NovaReply {
  const messages = draft.envoyer ? sanitizeMessages([draft.message]).slice(0, 1) : [];
  const reply: NovaReply = {
    id: nextId(state, "r"),
    kind: "relance",
    at: status.at,
    modelChoice: meta.modelChoice,
    modelLabel: meta.modelLabel,
    durationMs: meta.durationMs,
    messages,
    boutons: [],
    relanceUtile: false,
    noteEquipe: "",
    outils: [],
    plan: deliveryPlan(messages, { ...data, pacing: { ...data.pacing, debounceSeconds: 0 } }, 0, meta.rng),
    formatOk: true,
    corrected: false,
    context: "",
    relance: { numero: status.numero, total: status.total, envoyer: draft.envoyer, raison: draft.raison },
  };
  state.replies.push(reply);
  messages.forEach((text) => state.messages.push({ id: nextId(state, "m"), author: "nova", kind: "texte", text, at: status.at, status: "envoye", replyId: reply.id }));
  event(
    state,
    status.at,
    draft.envoyer ? "relance" : "relance_ignoree",
    draft.envoyer ? `Relance ${status.numero}/${status.total} envoyée` : `Relance ${status.numero}/${status.total} abandonnée`,
    draft.envoyer ? "info" : "warn",
    draft.raison,
  );
  return reply;
}

/* ------------------------------ Analyse « après » ------------------------------ */

export function analyseInput(state: LaboState, data: LaboData): string {
  const request = analyseRequest({
    lead: state.lead,
    contact: state.contact,
    history: historyMessages(state),
    assistantName: data.vars.ASSISTANT_NAME ?? "Nova",
    timezone: data.timezone,
  });
  return `${data.prompts.analyse}\n\n---\n\n${request}\n\nRéponds uniquement avec l'objet JSON : resume, temperature, prochaine_action, relance_manuelle, signaux, risques.`;
}

const TEMPERATURES: Temperature[] = ["froid", "tiede", "chaud", "brulant"];

export function parseAnalyse(text: string, now: number): LaboAnalyse | null {
  try {
    const o = parseJsonLoose(text) as Record<string, unknown>;
    if (typeof o.resume !== "string") return null;
    const temperature = TEMPERATURES.includes(o.temperature as Temperature) ? (o.temperature as Temperature) : "tiede";
    return {
      at: now,
      resume: o.resume,
      temperature,
      prochaine_action: typeof o.prochaine_action === "string" ? o.prochaine_action : "",
      relance_manuelle: typeof o.relance_manuelle === "string" ? o.relance_manuelle : "",
      signaux: strings(o.signaux),
      risques: strings(o.risques),
    };
  } catch {
    return null;
  }
}

/* ------------------------------ Prospect simulé ------------------------------ */

/** La demande au modèle qui joue le prospect (il ne voit jamais les consignes de Nova). */
export function personaInput(state: LaboState, data: LaboData, scenario: Scenario): string {
  const nova = data.vars.ASSISTANT_NAME ?? "Nova";
  const studio = data.vars.STUDIO_NAME ?? "le studio";
  const transcript = sentMessages(state)
    .map((m) => {
      if (m.author === "nova") return `[${nova}] ${m.text}`;
      if (m.kind === "postback") return `[Toi] (tu as touché la question d'accueil « ${m.text} »)`;
      return `[Toi] ${m.text}`;
    })
    .join("\n");
  return [
    `Tu joues un rôle dans un test : tu es un prospect qui échange en messages privés Instagram avec ${nova}, l'IA de ${studio}, un studio qui crée des applications iOS natives. Reste dans ton personnage du début à la fin.`,
    "",
    "# Qui tu es",
    scenario.jeu.qui,
    "",
    "# Ce que tu sais (révèle-le petit à petit, quand on te le demande ou quand c'est naturel)",
    scenario.jeu.secret,
    "",
    "# Comment tu écris",
    scenario.jeu.style,
    "",
    "# Ce que tu cherches",
    scenario.jeu.objectif,
    "",
    "# Règles du jeu",
    "- Tu écris comme sur Instagram : un ou deux messages courts.",
    `- Tu réagis à ce que ${nova} vient de dire, sans tout dire d'un coup.`,
    "- Tu ne contredis pas ta fiche ; pour le reste, improvise de façon crédible.",
    `- Si ${nova} te propose des créneaux et que l'un te convient, choisis-le en le recopiant.`,
    "- Si la conversation est terminée pour toi (rendez-vous calé, au revoir échangé, refus), mets \"fin\": true avec un dernier message très court, ou aucun.",
    "",
    "# La conversation jusqu'ici",
    transcript || "(aucun message)",
    "",
    'Écris ton prochain message. Réponds uniquement avec un objet JSON : {"messages": ["…"], "fin": false}',
  ].join("\n");
}

export function parsePersona(value: unknown): { messages: string[]; fin: boolean } {
  if (typeof value === "string") {
    try {
      return parsePersona(parseJsonLoose(value));
    } catch {
      return { messages: value.trim() ? [value.trim()] : [], fin: false };
    }
  }
  if (!value || typeof value !== "object") return { messages: [], fin: false };
  const o = value as Record<string, unknown>;
  return { messages: strings(o.messages).map((s) => s.trim()).filter(Boolean).slice(0, 2), fin: o.fin === true };
}
