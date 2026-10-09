/**
 * Interface du Labo Nova (navigateur). La logique métier vit dans runtime.ts ; ici : l'affichage,
 * le rythme d'envoi, les appels à Claude via la capacité `sample` de la page, et l'enregistrement
 * des avis via la capacité `db`.
 */
import { SCENARIOS, LIBRE, scenarioById, type Scenario } from "./personas.js";
import * as rt from "./runtime.js";
import { STAGE_LABELS, type Fiche, type Stage, type Temperature } from "../src/domain.js";
import { ficheAdvice } from "../src/ai/tool-logic.js";
import { FALLBACK_REPLY } from "../src/ai/conversation-context.js";

/* ------------------------------ Capacités de la page ------------------------------ */

interface SampleResult {
  text: string;
  truncated: boolean;
  modelTierApplied?: string;
  modelApplied?: string;
}
interface SampleError {
  code: string;
  message?: string;
  text?: string;
}
type SampleInput = string | rt.SampleTurn[];
interface SampleFn {
  (input: SampleInput, opts?: Record<string, unknown>): Promise<SampleResult>;
  json(input: SampleInput, opts?: Record<string, unknown>): Promise<unknown>;
}
interface DbCollection {
  add(data: Record<string, unknown>): Promise<unknown>;
}
interface DbCap {
  collection(path: string): DbCollection;
}
interface UserCap {
  id(): Promise<string | null>;
  can(name: string): Promise<boolean | null>;
}
interface PermissionsCap {
  manage(): Promise<void>;
}
interface ClaudeRuntime {
  use(name: string): Promise<unknown>;
}

declare global {
  interface Window {
    __LABO_DATA__: rt.LaboData;
    claude?: ClaudeRuntime;
  }
}

const data = window.__LABO_DATA__;
const NOVA = data.vars.ASSISTANT_NAME ?? "Nova";

let sample: SampleFn | null = null;
let sampleState: "loading" | "ready" | "absent" | "denied" = "loading";
let db: DbCap | null = null;
let user: UserCap | null = null;
let permissions: PermissionsCap | null = null;
let canWrite = false;

/* ------------------------------ État de la page ------------------------------ */

type Speed = "reel" | "x4" | "instant";
interface Settings {
  model: rt.ModelChoiceId;
  speed: Speed;
  bookingUrl: string;
}
interface Variant {
  modelChoice: rt.ModelChoiceId;
  modelLabel: string;
  durationMs: number;
  messages: string[];
  boutons: string[];
  outils: rt.ToolCall[];
  prefere?: string;
}
interface Note {
  t: number;
  text: string;
  error?: boolean;
}

const STORE_KEY = "labo-nova:v1";
const SPEED_FACTOR: Record<Speed, number> = { reel: 1, x4: 4, instant: 0 };

let settings: Settings = { model: "sonnet", speed: "x4", bookingUrl: data.bookingUrl };
let state: rt.LaboState;
let undoStack: rt.LaboState[] = [];
const avis = new Map<string, string>();
const avisOpen = new Map<string, string>();
const variants = new Map<string, Variant>();
const replyBase = new Map<string, rt.LaboState>();
const revealed = new Map<string, number>();
let notes: Note[] = [];
let job: { kind: "nova" | "persona" | "relance" | "analyse" | "compare" | "save"; ctl: AbortController } | null = null;
let delivering: { replyId: string; ctl: AbortController } | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let typing = false;
let seen = false;
let lastContext = "";
let freshKeys = new Set<string>();
let shareNote = "";
let shareSaved = false;
/** Le fil suit les nouveaux messages tant que la personne n'est pas remontée lire plus haut. */
let stickToBottom = true;

const now = () => Date.now() + state.clockOffsetMs;
const scale = (ms: number) => (settings.speed === "instant" ? 0 : ms / SPEED_FACTOR[settings.speed]);

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ state, settings, undo: undoStack.slice(-12), avis: Object.fromEntries(avis) }));
  } catch {
    /* stockage indisponible : l'essai vit seulement dans cet onglet */
  }
}

function restore(): boolean {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw) as { state?: rt.LaboState; settings?: Partial<Settings>; undo?: rt.LaboState[]; avis?: Record<string, string> };
    if (!saved.state || saved.state.v !== 1) return false;
    state = saved.state;
    settings = { ...settings, ...saved.settings };
    if (!(settings.model in rt.MODEL_CHOICES)) settings.model = "sonnet";
    if (!(settings.speed in SPEED_FACTOR)) settings.speed = "x4";
    undoStack = Array.isArray(saved.undo) ? saved.undo.filter((s) => s?.v === 1) : [];
    for (const [k, v] of Object.entries(saved.avis ?? {})) avis.set(k, v);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------ Petits outils DOM ------------------------------ */

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = String(v);
    else if (k === "text") el.textContent = String(v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** Remplace le contenu d'un élément en ignorant les enfants absents. */
function fill(el: HTMLElement, ...children: Child[]) {
  el.replaceChildren(...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false));
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("annulé", "AbortError"));
    if (ms <= 0) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("annulé", "AbortError"));
      },
      { once: true },
    );
  });
}

const TZ = data.timezone;
const fmtTime = (t: number) => new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(t);
const fmtDay = (t: number) => new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(t);
const fmtShortDay = (t: number) => new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).format(t);
const fmtSec = (ms: number) => `${(ms / 1000).toLocaleString("fr-FR", { maximumFractionDigits: ms < 10_000 ? 1 : 0 })} s`;
const fmtEur = (n: number) => `${n.toLocaleString("fr-FR")} €`;

function fmtDuration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const hours = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${hours} h ${String(rest).padStart(2, "0")}` : `${hours} h`;
}

function setStatus(text: string, error = false) {
  const el = $("status");
  el.textContent = text;
  el.classList.toggle("error", error);
}

function addNote(text: string, error = false) {
  notes.push({ t: now(), text, error });
  renderThread();
}

/* ------------------------------ Libellés ------------------------------ */

const SOURCE_SHORT: Record<string, string> = {
  dm: "Message direct",
  commentaire: "Commentaire sous un post",
  story: "Réponse à une story",
  mention: "Mention en story",
  pub: "Publicité",
  sortant: "Réponse à un message de l'équipe",
  ice_breaker: "Question d'accueil",
  bac_a_sable: "Test",
};
const TEMP_LABELS: Record<Temperature, string> = { brulant: "Brûlant", chaud: "Chaud", tiede: "Tiède", froid: "Froid" };
const BUDGET_PILL: Record<string, string> = { inconnu: "Budget inconnu", a_confirmer: "Budget à confirmer", ok: "Budget validé", insuffisant: "Budget insuffisant" };
const PIPELINE: Stage[] = ["nouveau", "decouverte", "qualification", "qualifie", "ebauche", "rdv_propose", "rdv_pris"];
const TERMINAL: Stage[] = ["non_qualifie", "perdu", "desinscrit", "gagne"];
const FIELD_LABELS: [keyof Fiche, string][] = [
  ["prenom", "Prénom"],
  ["projet", "Projet"],
  ["description", "L'app"],
  ["cible", "Pour qui"],
  ["probleme", "Problème"],
  ["fonctionnalites", "Fonctionnalités"],
  ["stade_projet", "Stade"],
  ["role", "Rôle"],
  ["societe_creee", "Société créée"],
  ["financement", "Financement"],
  ["montant_leve_eur", "Montant levé"],
  ["budget_declare", "Budget annoncé"],
  ["budget_estime_eur", "Budget estimé"],
  ["paiement_plusieurs_fois", "En plusieurs fois"],
  ["echeance", "Échéance"],
  ["decisionnaire", "Décide seul·e"],
  ["email", "Email"],
  ["telephone", "Téléphone"],
  ["site_web", "Site"],
  ["objections", "Objections"],
  ["signaux", "Signaux d'achat"],
  ["notes", "Notes"],
];
const STADE_LABELS: Record<string, string> = { idee: "Idée", maquette: "Maquette", prototype: "Prototype", app_existante: "App existante", business_existant: "Activité existante", autre: "Autre" };
const FINANCEMENT_LABELS: Record<string, string> = {
  fonds_propres: "fonds propres",
  love_money: "love money",
  pret_honneur: "prêt d'honneur",
  subvention: "subvention",
  levee_de_fonds: "levée de fonds",
  chiffre_affaires: "chiffre d'affaires",
  pret_bancaire: "prêt bancaire",
  aucun: "aucun",
  inconnu: "inconnu",
};

function fieldValue(key: keyof Fiche, value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => (key === "financement" ? FINANCEMENT_LABELS[String(v)] ?? String(v) : String(v))).join(", ");
  if (typeof value === "boolean") return value ? "oui" : "non";
  if (typeof value === "number") return key.endsWith("_eur") ? fmtEur(value) : value.toLocaleString("fr-FR");
  if (key === "stade_projet") return STADE_LABELS[String(value)] ?? String(value);
  return String(value);
}

function toolChip(call: rt.ToolCall): { label: string; tone: rt.EventTone } {
  const refused = call.resultat.refuse === true;
  const a = call.arguments;
  switch (call.nom) {
    case "maj_fiche": {
      const keys = Object.keys(a).filter((k) => k !== "budget_suffisant");
      const label = keys.map((k) => FIELD_LABELS.find(([f]) => f === k)?.[1].toLowerCase() ?? k).join(", ");
      return { label: `Fiche : ${label || "budget"}`, tone: "info" };
    }
    case "lancer_ebauche":
      return refused ? { label: "Ébauche refusée : budget non validé", tone: "warn" } : { label: "Ébauche lancée", tone: "ok" };
    case "proposer_rdv":
      return refused ? { label: "Appel refusé : budget non validé", tone: "warn" } : { label: "Créneaux d'appel obtenus", tone: "ok" };
    case "noter_rdv":
      return { label: `Rendez-vous noté : ${String(a.quand ?? "")}`, tone: "hot" };
    case "passer_la_main":
      return { label: `Relais humain : ${String(a.raison ?? "")}`, tone: "hot" };
    case "clore_conversation":
      return { label: `Conversation close : ${String(a.motif ?? "")}`, tone: "warn" };
    case "desinscrire":
      return { label: a.effacer_donnees === true ? "Désinscription et effacement" : "Désinscription", tone: "warn" };
    default:
      return { label: `Outil inconnu : ${call.nom}`, tone: "warn" };
  }
}

/* ------------------------------ Appels à Claude ------------------------------ */

function callSample(input: SampleInput, choice: rt.ModelChoice, signal: AbortSignal): Promise<SampleResult> {
  if (!sample) return Promise.reject({ code: "not_granted", message: "Claude indisponible dans cette vue" });
  const opts: Record<string, unknown> = { cache: false, signal, modelTier: choice.modelTier };
  if (choice.model) opts.model = choice.model;
  if (choice.effort) opts.effort = choice.effort;
  return sample(input, opts);
}

function handleError(e: unknown, what: string) {
  const err = (e ?? {}) as SampleError;
  if ((e as Error)?.name === "AbortError" || err.code === "cancelled") {
    setStatus("");
    return;
  }
  switch (err.code) {
    case "not_granted":
      sampleState = "denied";
      setStatus("");
      break;
    case "sampling_disabled":
    case "not_declared":
    case "capability_disabled":
    case "capability_removed":
      sampleState = "absent";
      setStatus("");
      break;
    case "rate_limited":
      setStatus("Trop de demandes d'un coup, ou limite d'usage Claude atteinte : réessaie dans quelques minutes.", true);
      break;
    case "session_expired":
      setStatus("Ta session Claude a expiré : reconnecte-toi, puis réessaie.", true);
      break;
    case "prompt_too_large":
      setStatus("La conversation est devenue trop longue pour le Labo : recommence un essai.", true);
      break;
    default:
      setStatus(`${what} interrompue (${err.code ?? "erreur réseau"}). Tu peux réessayer.`, true);
  }
  renderBanner();
  renderControls();
}

function startJob(kind: NonNullable<typeof job>["kind"]): AbortController {
  job?.ctl.abort();
  const ctl = new AbortController();
  job = { kind, ctl };
  renderControls();
  return ctl;
}

function endJob(ctl: AbortController) {
  if (job?.ctl === ctl) job = null;
  renderControls();
}

const toolOpts = (at: number): rt.ToolOptions => ({ now: at, bookingUrl: settings.bookingUrl.trim() });

/* ------------------------------ Conversation ------------------------------ */

function pushUndo() {
  undoStack.push(rt.cloneState(state));
  if (undoStack.length > 30) undoStack.shift();
}

function interrupt(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (job && (job.kind === "nova" || job.kind === "persona" || job.kind === "compare")) job.ctl.abort();
  if (delivering) {
    const { replyId, ctl } = delivering;
    ctl.abort();
    delivering = null;
    const shown = revealed.get(replyId) ?? 0;
    const cancelled = rt.cancelBubbles(state, replyId, shown);
    if (cancelled) notes.push({ t: now(), text: `${cancelled} bulle${cancelled > 1 ? "s" : ""} pas encore envoyée${cancelled > 1 ? "s" : ""} annulée${cancelled > 1 ? "s" : ""} : le prospect a écrit entre-temps, ${NOVA} reprend avec tout le contexte.` });
    revealed.delete(replyId);
  }
  typing = false;
}

function sendProspect(text: string) {
  const parts = text
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return;
  interrupt();
  pushUndo();
  for (const p of parts) rt.addProspectMessage(state, p, now());
  seen = false;
  shareSaved = false;
  persist();
  renderAll();
  scheduleNova();
}

function scheduleNova() {
  if (debounceTimer) clearTimeout(debounceTimer);
  if (!sample) {
    renderControls();
    return;
  }
  const reason = rt.silenceReason(state, now());
  if (reason) {
    addNote(reason);
    return;
  }
  const delay = scale(data.pacing.debounceSeconds * 1000);
  if (delay > 0) setStatus(`${NOVA} attend la suite du message (regroupement de ${data.pacing.debounceSeconds} s en production)…`);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void runNova();
  }, delay);
  renderControls();
}

async function runNova(): Promise<void> {
  if (!sample) return;
  const reason = rt.silenceReason(state, now());
  if (reason) {
    addNote(reason);
    return;
  }
  if (!rt.awaitingNova(state)) {
    setStatus(`Rien à répondre : le dernier message vient de ${NOVA}.`);
    return;
  }
  const ctl = startJob("nova");
  const choice = rt.MODEL_CHOICES[settings.model];
  const started = performance.now();
  seen = true;
  typing = true;
  renderThread();
  setStatus(`${choice.label} lit la conversation…`);
  try {
    const request = rt.novaRequest(state, data, toolOpts(now()));
    lastContext = request.context;
    renderPromptPanel();
    const res = await callSample(request.input, choice, ctl.signal);
    const before = rt.cloneState(state);
    const at = now();
    let parsed = rt.parseNovaReply(res.text);
    let { calls, refused } = rt.applyTools(state, data, parsed, toolOpts(at));
    let corrected = false;
    if (refused && parsed.formatOk) {
      setStatus("Un outil a refusé l'action : Nova réécrit sa réponse en conséquence…");
      const res2 = await callSample(rt.correctionRequest(request, res.text, calls), choice, ctl.signal);
      const second = rt.parseNovaReply(res2.text);
      const extra = rt.applyTools(state, data, { ...second, outils: second.outils.filter((t) => !calls.some((c) => c.nom === t.nom)) }, toolOpts(at));
      calls = [...calls, ...extra.calls];
      parsed = second;
      corrected = true;
    }
    const reply = rt.recordReply(state, data, parsed, calls, {
      now: at,
      modelChoice: choice.id,
      modelLabel: rt.answeredBy(choice, res.modelApplied, res.modelTierApplied),
      durationMs: Math.round(performance.now() - started),
      corrected,
      context: request.context,
      firstMessage: request.firstMessage,
      rng: Math.random,
    });
    undoStack.push(before);
    replyBase.set(reply.id, before);
    freshKeys = new Set(calls.filter((c) => c.nom === "maj_fiche").flatMap((c) => Object.keys(c.arguments)));
    revealed.set(reply.id, 0);
    typing = false;
    persist();
    endJob(ctl);
    renderAll();
    if (!reply.messages.length) {
      setStatus(`${NOVA} ne répond pas : rien n'appelle de réponse.`);
      revealed.delete(reply.id);
      renderThread();
      return;
    }
    setStatus("");
    await deliver(reply);
  } catch (e) {
    typing = false;
    handleError(e, "Réponse de Nova");
    if ((e as SampleError)?.code === "refused") fallbackAfterRefusal();
  } finally {
    endJob(ctl);
    typing = false;
    renderThread();
  }
}

/** Comme le moteur : refus du modèle, un humain prend le relais et le prospect n'est pas laissé sans réponse. */
function fallbackAfterRefusal() {
  const at = now();
  const before = rt.cloneState(state);
  const parsed: rt.ParsedReply = { formatOk: true, outils: [{ nom: "passer_la_main", arguments: { raison: "Le modèle a refusé de répondre à ce message.", urgence: "haute" } }], messages: [FALLBACK_REPLY], boutons: [], relanceUtile: false, noteEquipe: "Refus du modèle : à traiter à la main." };
  const { calls } = rt.applyTools(state, data, parsed, toolOpts(at));
  const choice = rt.MODEL_CHOICES[settings.model];
  const reply = rt.recordReply(state, data, parsed, calls, { now: at, modelChoice: choice.id, modelLabel: `${choice.label} (refus)`, durationMs: 0, corrected: false, context: lastContext, firstMessage: false, rng: Math.random });
  undoStack.push(before);
  persist();
  setStatus("Claude a refusé de répondre : comme en production, la conversation passe à un humain.", true);
  renderAll();
  void deliver(reply);
}

async function deliver(reply: rt.NovaReply): Promise<void> {
  const ctl = new AbortController();
  delivering = { replyId: reply.id, ctl };
  renderControls();
  try {
    for (let i = 0; i < reply.messages.length; i++) {
      const step = reply.plan[i] ?? { waitBeforeTypingMs: 0, typingMs: 0 };
      await wait(scale(step.waitBeforeTypingMs), ctl.signal);
      typing = scale(step.typingMs) > 0;
      renderThread();
      await wait(scale(step.typingMs), ctl.signal);
      typing = false;
      revealed.set(reply.id, i + 1);
      renderThread();
    }
    revealed.delete(reply.id);
  } catch {
    /* interrompu : bulles annulées ou affichées d'un coup */
  } finally {
    if (delivering?.ctl === ctl) delivering = null;
    typing = false;
    renderAll();
  }
}

async function askPersona() {
  const scenario = scenarioById(state.scenarioId);
  if (scenario.id === LIBRE.id || !sample) return;
  const ctl = startJob("persona");
  setStatus(`${scenario.prenom} écrit…`);
  try {
    const value = await sample.json(rt.personaInput(state, data, scenario), { modelTier: "quick", cache: false, signal: ctl.signal });
    const p = rt.parsePersona(value);
    endJob(ctl);
    if (!p.messages.length) {
      setStatus(p.fin ? `${scenario.prenom} n'a plus rien à ajouter : la conversation est terminée de son côté.` : "Pas de message cette fois : réessaie.");
      return;
    }
    setStatus(p.fin ? `Dernier message de ${scenario.prenom} : la conversation se termine de son côté.` : "");
    sendProspect(p.messages.join("\n\n"));
  } catch (e) {
    handleError(e, "Réponse du prospect");
  } finally {
    endJob(ctl);
  }
}

async function simulateSilence() {
  if (!sample) return;
  const status = rt.relanceStatus(state, data, now());
  if (!status.possible) {
    addNote(`Pas de relance : ${status.raison}`);
    return;
  }
  interrupt();
  pushUndo();
  const ctl = startJob("relance");
  const choice = rt.MODEL_CHOICES[settings.model];
  const jump = Math.max(0, status.at - now());
  state.clockOffsetMs += jump;
  notes.push({ t: status.at - 1, text: `${fmtDuration(jump)} sans réponse : le moteur déclenche la relance ${status.numero}/${status.total}.` });
  renderAll();
  setStatus(`${choice.label} prépare la relance ${status.numero}/${status.total}…`);
  const started = performance.now();
  try {
    const res = await callSample(rt.relanceInput(state, data, status.numero, status.total, now()), choice, ctl.signal);
    const draft = rt.parseRelance(res.text);
    const reply = rt.recordRelance(state, data, status, draft, {
      modelChoice: choice.id,
      modelLabel: rt.answeredBy(choice, res.modelApplied, res.modelTierApplied),
      durationMs: Math.round(performance.now() - started),
      rng: Math.random,
    });
    persist();
    endJob(ctl);
    setStatus(draft.envoyer ? "" : `${NOVA} renonce à relancer : ${draft.raison}`);
    if (draft.envoyer) {
      revealed.set(reply.id, 0);
      renderAll();
      await deliver(reply);
    } else renderAll();
  } catch (e) {
    const previous = undoStack.pop();
    if (previous) state = previous;
    notes = notes.filter((n) => n.t < status.at - 1);
    handleError(e, "Relance");
    renderAll();
  } finally {
    endJob(ctl);
  }
}

async function runAnalyse() {
  if (!sample) return;
  const ctl = startJob("analyse");
  setStatus("Analyse de la conversation pour l'équipe…");
  renderDossier();
  try {
    const res = await callSample(rt.analyseInput(state, data), rt.MODEL_CHOICES.rapide, ctl.signal);
    const a = rt.parseAnalyse(res.text, now());
    if (!a) throw { code: "invalid_json" };
    state.analyse = a;
    persist();
    setStatus("");
  } catch (e) {
    handleError(e, "Analyse");
  } finally {
    endJob(ctl);
    renderDossier();
  }
}

async function compareReply(replyId: string) {
  const reply = state.replies.find((r) => r.id === replyId);
  const base = replyBase.get(replyId);
  if (!reply || !base || !sample) return;
  const altId: rt.ModelChoiceId = reply.modelChoice === "opus" ? "sonnet" : "opus";
  const choice = rt.MODEL_CHOICES[altId];
  const ctl = startJob("compare");
  setStatus(`${choice.label} répond au même message, pour comparer…`);
  const started = performance.now();
  try {
    const work = rt.cloneState(base);
    const request = rt.novaRequest(work, data, toolOpts(reply.at));
    const res = await callSample(request.input, choice, ctl.signal);
    let parsed = rt.parseNovaReply(res.text);
    let { calls, refused } = rt.applyTools(work, data, parsed, toolOpts(reply.at));
    if (refused && parsed.formatOk) {
      const res2 = await callSample(rt.correctionRequest(request, res.text, calls), choice, ctl.signal);
      parsed = rt.parseNovaReply(res2.text);
      calls = [...calls, ...rt.applyTools(work, data, parsed, toolOpts(reply.at)).calls];
    }
    const alt = rt.recordReply(work, data, parsed, calls, {
      now: reply.at,
      modelChoice: altId,
      modelLabel: rt.answeredBy(choice, res.modelApplied, res.modelTierApplied),
      durationMs: Math.round(performance.now() - started),
      corrected: false,
      context: request.context,
      firstMessage: request.firstMessage,
      rng: Math.random,
    });
    variants.set(replyId, { modelChoice: altId, modelLabel: alt.modelLabel, durationMs: alt.durationMs, messages: alt.messages, boutons: alt.boutons, outils: alt.outils });
    setStatus("");
  } catch (e) {
    handleError(e, "Comparaison");
  } finally {
    endJob(ctl);
    renderThread();
  }
}

/* ------------------------------ Avis et partage ------------------------------ */

function transcriptUntil(at: number): string {
  return rt
    .sentMessages(state)
    .filter((m) => m.at <= at + 10)
    .map((m) => `${m.author === "nova" ? NOVA : "Prospect"} : ${m.text}`)
    .join("\n");
}

async function saveDoc(collection: string, doc: Record<string, unknown>): Promise<boolean> {
  if (!db) return false;
  try {
    const author = user ? await user.id() : null;
    await db.collection(collection).add({ ...doc, auteur: author, version_prompt: data.commit, labo_build: data.builtAt, cree_le: new Date().toISOString() });
    return true;
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "invalid_argument") canWrite = false;
    setStatus(code === "quota_exceeded" ? "Espace de stockage des avis plein : préviens Claude pour faire le tri." : "Avis non enregistré : tu n'as peut-être pas le droit d'écrire ici.", true);
    renderThread();
    renderDossier();
    return false;
  }
}

async function saveAvis(replyId: string, verdict: "juste" | "a_revoir", commentaire: string) {
  const reply = state.replies.find((r) => r.id === replyId);
  if (!reply) return;
  const ok = await saveDoc("avis", {
    verdict,
    commentaire: commentaire.trim(),
    scenario: state.scenarioId,
    modele: reply.modelLabel,
    type_reponse: reply.kind,
    reponse: { messages: reply.messages, boutons: reply.boutons, outils: reply.outils.map((c) => ({ nom: c.nom, arguments: c.arguments })), note_equipe: reply.noteEquipe, relance: reply.relance ?? null },
    conversation: transcriptUntil(reply.at),
    etape: state.lead.stage,
    budget: state.lead.budget_status,
    fiche: state.lead.fiche,
    contexte: reply.context,
  });
  if (ok) {
    avis.set(replyId, verdict);
    avisOpen.delete(replyId);
    persist();
  }
  renderThread();
}

async function savePreference(replyId: string, prefere: string) {
  const reply = state.replies.find((r) => r.id === replyId);
  const variant = variants.get(replyId);
  if (!reply || !variant) return;
  const ok = await saveDoc("comparaisons", {
    prefere,
    scenario: state.scenarioId,
    conversation: transcriptUntil(reply.at - 1),
    a: { modele: reply.modelLabel, messages: reply.messages, outils: reply.outils.map((c) => c.nom) },
    b: { modele: variant.modelLabel, messages: variant.messages, outils: variant.outils.map((c) => c.nom) },
  });
  if (ok) variant.prefere = prefere;
  renderThread();
}

async function shareEssai() {
  const ctl = startJob("save");
  const ok = await saveDoc("essais", {
    scenario: state.scenarioId,
    modele: rt.MODEL_CHOICES[settings.model].label,
    note: shareNote.trim(),
    conversation: transcriptUntil(now()),
    etape: state.lead.stage,
    budget: state.lead.budget_status,
    score: state.lead.score,
    fiche: state.lead.fiche,
    evenements: state.events.map((e) => `${e.label}${e.detail ? ` : ${e.detail}` : ""}`),
    alertes: state.notifications.map((n) => n.titre),
    analyse: state.analyse,
  });
  endJob(ctl);
  if (ok) {
    shareSaved = true;
    shareNote = "";
  }
  renderDossier();
}

/* ------------------------------ Rendu : en-tête et scénarios ------------------------------ */

function renderHeader() {
  const built = new Date(data.builtAt);
  $("build-line").textContent = `L'IA des DM de ${data.vars.STUDIO_NAME ?? "YD Studio"}, avec le prompt de production du ${new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" }).format(built)} (version ${data.commit}).`;
  const modelSeg = $("model-seg");
  modelSeg.replaceChildren(
    ...Object.values(rt.MODEL_CHOICES).map((c) =>
      h(
        "button",
        {
          type: "button",
          role: "radio",
          "aria-checked": String(settings.model === c.id),
          title: c.model ? `${c.label} (${c.model})` : "Le modèle le plus rapide de Claude",
          onclick: () => {
            settings.model = c.id;
            persist();
            renderHeader();
            renderControls();
          },
        },
        c.label,
        h("small", { text: c.detail }),
      ),
    ),
  );
  const speeds: [Speed, string, string][] = [
    ["reel", "Réel", "délais de production"],
    ["x4", "×4", "accéléré"],
    ["instant", "Instantané", "sans attente"],
  ];
  $("speed-seg").replaceChildren(
    ...speeds.map(([id, label, detail]) =>
      h(
        "button",
        {
          type: "button",
          role: "radio",
          "aria-checked": String(settings.speed === id),
          onclick: () => {
            settings.speed = id;
            persist();
            renderHeader();
          },
        },
        label,
        h("small", { text: detail }),
      ),
    ),
  );
}

function selectScenario(scenario: Scenario) {
  interrupt();
  if (rt.sentMessages(state).length > 1) pushUndo();
  state = rt.newState(scenario, Date.now());
  notes = [];
  variants.clear();
  replyBase.clear();
  revealed.clear();
  seen = false;
  shareSaved = false;
  lastContext = "";
  setStatus(scenario.id === LIBRE.id ? "Écris le premier message du prospect." : `Premier message de ${scenario.prenom} reçu : fais répondre ${NOVA}.`);
  persist();
  renderAll();
  if (scenario.id === LIBRE.id) $("draft").focus();
}

function renderScenarios() {
  const list = $("scenario-list");
  list.replaceChildren(
    ...[...SCENARIOS, LIBRE].map((s) =>
      h(
        "li",
        {},
        h(
          "button",
          { type: "button", class: "scenario", "aria-pressed": String(state.scenarioId === s.id), onclick: () => selectScenario(s) },
          h("span", { class: "name" }, s.nom),
          h("span", { class: `tag t-${s.tone}`, text: s.tag }),
          h("span", { class: "what", text: s.teste }),
        ),
      ),
    ),
  );
}

function renderBanner() {
  const banner = $("banner");
  banner.replaceChildren();
  banner.hidden = true;
  if (sampleState === "absent") {
    banner.hidden = false;
    banner.append(h("b", { text: "Nova ne peut pas répondre ici." }), h("span", { text: " Ouvre ce Labo depuis Claude (claude.ai ou l'app) pour discuter avec elle : la fiche, les scénarios et le prompt restent consultables." }));
  } else if (sampleState === "denied") {
    banner.hidden = false;
    banner.append(h("b", { text: "Claude n'est pas autorisé pour ce Labo." }), h("span", { text: " Autorise-le pour faire répondre Nova (les réponses utilisent ton forfait Claude)." }));
    if (permissions) banner.append(h("button", { class: "ghost", type: "button", text: "Ouvrir les autorisations", onclick: () => void permissions?.manage().catch(() => undefined) }));
  }
}

function renderControls() {
  const scenario = scenarioById(state.scenarioId);
  const ai = !!sample && sampleState === "ready";
  const busy = !!job;
  const persona = $<HTMLButtonElement>("persona-btn");
  persona.hidden = scenario.id === LIBRE.id;
  persona.textContent = `Réponse de ${scenario.prenom}`;
  persona.disabled = !ai || busy || !!delivering || !!debounceTimer || rt.awaitingNova(state) || state.contact.opted_out;
  persona.className = !persona.disabled && rt.sentMessages(state).length > 0 ? "primary" : "ghost";
  const nova = $<HTMLButtonElement>("nova-btn");
  nova.textContent = `Faire répondre ${NOVA}`;
  nova.disabled = !ai || busy || !!delivering || !rt.awaitingNova(state);
  nova.className = rt.awaitingNova(state) && !busy && !debounceTimer ? "primary" : "ghost";
  const silence = $<HTMLButtonElement>("silence-btn");
  silence.disabled = !ai || busy || !!delivering || rt.awaitingNova(state);
  $<HTMLButtonElement>("send-btn").disabled = false;
  $<HTMLButtonElement>("undo-btn").disabled = !undoStack.length;
  const stop = $<HTMLButtonElement>("stop-btn");
  stop.hidden = !busy && !delivering && !debounceTimer;
}

/* ------------------------------ Rendu : conversation ------------------------------ */

function renderContact() {
  const c = state.contact;
  const label = c.name ?? (c.username ? `@${c.username}` : "Prospect");
  const initials = (c.name ?? c.username ?? "?")
    .replace(/[^\p{L}\s.]/gu, " ")
    .split(/[\s.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  $("avatar").textContent = initials || "?";
  $("contact-name").textContent = label;
  const bits = [c.username && c.name ? `@${c.username}` : null, c.follower_count != null ? `${c.follower_count.toLocaleString("fr-FR")} abonnés` : null, state.conversation.source_ref ?? SOURCE_SHORT[state.conversation.source]];
  $("contact-source").textContent = bits.filter(Boolean).join(" · ");
  renderClock();
}

function renderClock() {
  const t = now();
  $("sim-clock").textContent = `${fmtShortDay(t)} · ${fmtTime(t)}`;
}

type Item = { t: number; order: number; msg?: rt.LaboMessage; node: () => Node[] };

/** Une bulle de Nova pas encore « envoyée » (animation en cours) reste invisible. */
function isVisible(m: rt.LaboMessage): boolean {
  if (m.author !== "nova" || !m.replyId || m.status !== "envoye") return true;
  const shown = revealed.get(m.replyId);
  if (shown === undefined) return true;
  return state.messages.filter((x) => x.replyId === m.replyId).indexOf(m) < shown;
}

function renderThread() {
  const thread = $("thread");
  const focusId = document.activeElement instanceof HTMLElement && thread.contains(document.activeElement) ? document.activeElement.id : "";
  const items: Item[] = [];
  const replies = new Map(state.replies.map((r) => [r.id, r]));
  let order = 0;

  for (const r of state.replies) {
    const chips = r.outils.map(toolChip);
    items.push({
      t: r.at - 0.5,
      order: order++,
      node: () => (chips.length ? [h("div", { class: "chips" }, ...chips.map((c) => h("span", { class: `chip ${c.tone}`, title: c.label }, h("span", { text: c.label }))))] : []),
    });
    items.push({ t: r.at + 2.5, order: order++, node: () => replyTail(r) });
  }
  for (const m of state.messages) {
    items.push({ t: m.at, order: order++, msg: m, node: () => messageNodes(m, replies) });
  }
  for (const n of notes) items.push({ t: n.t, order: order++, node: () => [h("div", { class: `system-note${n.error ? " error" : ""}`, text: n.text })] });
  items.sort((a, b) => a.t - b.t || a.order - b.order);

  const nodes: Node[] = [];
  let lastMsgAt: number | null = null;
  for (const item of items) {
    const msg = item.msg;
    if (msg && msg.status === "envoye" && isVisible(msg)) {
      if (lastMsgAt === null) nodes.push(h("div", { class: "sep" }, h("b", { text: fmtDay(msg.at) }), `, ${fmtTime(msg.at)}`));
      else if (msg.at - lastMsgAt > 30 * 60_000) nodes.push(h("div", { class: "sep" }, h("b", { text: `${fmtDuration(msg.at - lastMsgAt)} plus tard` }), ` · ${fmtDay(msg.at)}, ${fmtTime(msg.at)}`));
      lastMsgAt = msg.at;
    }
    nodes.push(...item.node());
  }
  if (!rt.sentMessages(state).length) {
    nodes.push(h("p", { class: "empty-thread", text: "Écris le premier message du prospect en bas, comme s'il arrivait en DM sur Instagram." }));
  }
  const lastVisible = rt.sentMessages(state).filter(isVisible).at(-1);
  if (seen && lastVisible?.author === "prospect") nodes.push(h("div", { class: "seen", text: `Vu par ${NOVA}` }));
  if (typing) nodes.push(h("div", { class: "typing", "aria-label": `${NOVA} écrit` }, h("i"), h("i"), h("i")));
  thread.replaceChildren(...nodes);
  if (stickToBottom || typing) thread.scrollTop = thread.scrollHeight;
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el instanceof HTMLTextAreaElement) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }
  renderQuickReplies();
  renderControls();
}

function messageNodes(m: rt.LaboMessage, replies: Map<string, rt.NovaReply>): Node[] {
  if (m.author === "prospect") {
    const cls = m.kind === "postback" ? "bubble them postback" : "bubble them";
    return [h("div", { class: cls, text: m.text, title: m.kind === "postback" ? "Question d'accueil touchée par le prospect" : undefined })];
  }
  const reply = m.replyId ? replies.get(m.replyId) : undefined;
  if (!isVisible(m)) return [];
  if (m.status === "annule") return [h("div", { class: "bubble nova cancelled", text: m.text, title: "Bulle annulée : le prospect a écrit avant son envoi" })];
  const relance = reply?.kind === "relance";
  return [h("div", { class: `bubble nova${relance ? " relance" : ""}`, text: m.text })];
}

function pacingBar(r: rt.NovaReply): HTMLElement {
  const segments: [string, number, string][] = [];
  if (r.kind === "reponse") {
    segments.push(["p-debounce", data.pacing.debounceSeconds * 1000, `Regroupement ${data.pacing.debounceSeconds} s`]);
    segments.push(["p-gen", r.durationMs, `Réflexion de l'IA ${fmtSec(r.durationMs)}`]);
  }
  r.plan.forEach((s, i) => {
    segments.push(["p-wait", s.waitBeforeTypingMs, i === 0 ? `Lecture ${fmtSec(s.waitBeforeTypingMs)}` : `Pause ${fmtSec(s.waitBeforeTypingMs)}`]);
    segments.push(["p-type", s.typingMs, `Bulle ${i + 1} : frappe ${fmtSec(s.typingMs)}`]);
  });
  const total = segments.reduce((a, [, ms]) => a + ms, 0) || 1;
  return h(
    "div",
    { class: "pacing", role: "img", "aria-label": segments.map(([, , l]) => l).join(", ") },
    ...segments.filter(([, ms]) => ms > 0).map(([cls, ms, label]) => h("i", { class: cls, title: label, style: `width:${((ms / total) * 100).toFixed(2)}%` })),
  );
}

function replyTail(r: rt.NovaReply): Node[] {
  const shown = revealed.get(r.id);
  if (shown !== undefined) return [];
  const out: Node[] = [];
  if (r.kind === "relance" && r.relance && !r.relance.envoyer) {
    out.push(h("div", { class: "system-note", text: `Relance ${r.relance.numero}/${r.relance.total} abandonnée par ${NOVA} : ${r.relance.raison}` }));
    return out;
  }
  if (!r.messages.length) {
    out.push(h("div", { class: "system-note", text: `${NOVA} ne répond pas : rien n'appelle de réponse.` }));
  }
  if (r.noteEquipe) out.push(h("div", { class: "note-equipe", text: `Note pour l'équipe : ${r.noteEquipe}` }));
  const line: Node[] = [];
  if (r.kind === "relance" && r.relance) line.push(h("span", { text: `Relance ${r.relance.numero}/${r.relance.total}` }));
  line.push(h("span", { text: r.modelLabel }));
  line.push(h("span", { text: `réponse en ${fmtSec(r.durationMs)}` }));
  if (r.kind === "reponse" && r.messages.length) line.push(h("span", { text: `en production : 1re bulle à +${fmtSec(rt.firstBubbleDelayMs(r, data))}` }));
  if (r.corrected) line.push(h("span", { class: "warn", text: "réécrite après refus d'un outil" }));
  if (!r.formatOk) line.push(h("span", { class: "warn", text: "réponse hors format JSON" }));
  const meta = h("div", { class: "meta" }, h("div", { class: "meta-line" }, ...line));
  if (r.messages.length) meta.append(pacingBar(r));
  meta.append(feedbackNodes(r));
  out.push(meta);
  const variant = variants.get(r.id);
  if (variant) out.push(variantCard(r, variant));
  return out;
}

function feedbackNodes(r: rt.NovaReply): HTMLElement {
  const box = h("div", { class: "feedback" });
  const saved = avis.get(r.id);
  if (saved) {
    box.append(h("span", { class: "saved", text: saved === "juste" ? "Avis enregistré : juste" : "Avis enregistré : à revoir" }));
  } else if (db && canWrite && r.messages.length) {
    const open = avisOpen.has(r.id);
    if (open) {
      const area = h("textarea", { id: `avis-${r.id}`, placeholder: `Ce que ${NOVA} aurait dû dire ou faire`, "aria-label": "Commentaire" }) as HTMLTextAreaElement;
      area.value = avisOpen.get(r.id) ?? "";
      area.addEventListener("input", () => avisOpen.set(r.id, area.value));
      box.append(
        h(
          "div",
          { class: "avis-form" },
          area,
          h(
            "div",
            { class: "row" },
            h("button", { type: "button", class: "mini", text: "Annuler", onclick: () => { avisOpen.delete(r.id); renderThread(); } }),
            h("button", { type: "button", class: "mini", "aria-pressed": "true", text: "Enregistrer l'avis", onclick: () => void saveAvis(r.id, "a_revoir", area.value) }),
          ),
        ),
      );
    } else {
      box.append(
        h("button", { type: "button", class: "mini", text: "Juste", title: "Cette réponse est bonne", onclick: () => void saveAvis(r.id, "juste", "") }),
        h("button", { type: "button", class: "mini", text: "À revoir", title: "Expliquer ce qui ne va pas", onclick: () => { avisOpen.set(r.id, ""); renderThread(); } }),
      );
    }
  }
  const isLast = state.replies.at(-1)?.id === r.id;
  if (isLast && r.kind === "reponse" && replyBase.has(r.id) && !variants.has(r.id) && sample) {
    const alt = r.modelChoice === "opus" ? rt.MODEL_CHOICES.sonnet : rt.MODEL_CHOICES.opus;
    box.append(h("button", { type: "button", class: "mini", text: `Comparer avec ${alt.label}`, disabled: !!job || !!delivering, onclick: () => void compareReply(r.id) }));
  }
  return box;
}

function variantCard(r: rt.NovaReply, v: Variant): HTMLElement {
  const card = h("div", { class: "variant" }, h("h3", { text: `Variante : ${v.modelLabel} · ${fmtSec(v.durationMs)}` }));
  const chips = v.outils.map(toolChip);
  if (chips.length) card.append(h("div", { class: "chips" }, ...chips.map((c) => h("span", { class: `chip ${c.tone}` }, h("span", { text: c.label })))));
  for (const m of v.messages) card.append(h("div", { class: "bubble nova", text: m }));
  if (!v.messages.length) card.append(h("p", { class: "muted", text: "Pas de message dans cette variante." }));
  const row = h("div", { class: "feedback" });
  if (v.prefere) row.append(h("span", { class: "saved", text: `Préférence enregistrée : ${v.prefere}` }));
  else if (db && canWrite) {
    const a = r.modelLabel.split(" indisponible")[0]!;
    const b = v.modelLabel.split(" indisponible")[0]!;
    row.append(
      h("button", { type: "button", class: "mini", text: `Je préfère ${a}`, onclick: () => void savePreference(r.id, a) }),
      h("button", { type: "button", class: "mini", text: `Je préfère ${b}`, onclick: () => void savePreference(r.id, b) }),
      h("button", { type: "button", class: "mini", text: "Égalité", onclick: () => void savePreference(r.id, "égalité") }),
    );
  }
  card.append(row);
  return card;
}

function renderQuickReplies() {
  const quick = $("quick");
  quick.replaceChildren();
  const last = rt.sentMessages(state).at(-1);
  if (!last || last.author !== "nova" || delivering) return;
  const reply = state.replies.find((r) => r.id === last.replyId);
  if (!reply?.boutons.length) return;
  quick.append(...reply.boutons.map((b) => h("button", { type: "button", text: b, onclick: () => sendProspect(b) })));
}

/* ------------------------------ Rendu : fiche et instruments ------------------------------ */

function renderStagePanel() {
  const lead = state.lead;
  const panel = $("stage-panel");
  const terminal = TERMINAL.includes(lead.stage);
  const stage = lead.stage === "a_relancer" ? "decouverte" : lead.stage;
  const index = PIPELINE.indexOf(stage);
  const bar = h(
    "div",
    { class: `stage-bar${terminal ? " terminal" : ""}`, role: "img", "aria-label": `Étape ${STAGE_LABELS[lead.stage]}` },
    ...PIPELINE.map((_, i) => h("i", { class: terminal ? "done" : i < index ? "done" : i === index ? "now" : "" })),
  );
  const win = rt.windowInfo(state, now());
  const winPct = Math.min(100, (win.remainingMs / (24 * 3_600_000)) * 100);
  const winCls = !win.open ? "closed" : win.remainingMs < 3 * 3_600_000 ? "low" : "";
  const paused = state.aiPausedUntil && state.aiPausedUntil > now();
  fill(panel, 
    h("h2", {}, "Étape", h("small", { text: terminal ? "conversation terminée" : `${index + 1} sur ${PIPELINE.length}` })),
    h("div", { class: `stage-name${terminal ? " terminal" : ""}`, text: STAGE_LABELS[lead.stage] }),
    bar,
    h("div", { class: "stage-steps" }, h("span", { text: "Nouveau" }), h("span", { text: "Budget validé" }), h("span", { text: "RDV pris" })),
    h(
      "div",
      { class: "gauges" },
      h("div", { class: "score" }, h("b", { text: String(lead.score) }), h("span", { text: "/100" })),
      h("div", { class: "pills" }, h("span", { class: `pill ${lead.temperature}`, text: TEMP_LABELS[lead.temperature] }), h("span", { class: `pill b-${lead.budget_status}`, text: BUDGET_PILL[lead.budget_status] })),
      h("div", { class: "scorebar", "aria-hidden": "true" }, h("i", { style: `width:${lead.score}%` })),
    ),
    paused
      ? h(
          "div",
          { class: "window" },
          h("div", { class: "label" }, h("span", { text: `IA en pause jusqu'à ${fmtTime(state.aiPausedUntil!)}` }), h("button", { type: "button", class: "mini", text: "Réactiver l'IA", onclick: () => { rt.resumeAi(state, now()); persist(); renderAll(); } })),
          h("p", { text: "Un humain a pris le relais : le moteur ne répond plus automatiquement à ce prospect." }),
        )
      : null,
    h(
      "div",
      { class: "window" },
      h("div", { class: "label" }, h("span", { text: "Fenêtre Instagram" }), h("b", { text: state.lastInboundAt ? (win.open ? `${fmtDuration(win.remainingMs)} restantes` : "fermée") : "—" })),
      h("div", { class: "bar" }, h("i", { class: winCls, style: `width:${state.lastInboundAt ? winPct : 0}%` })),
      h("p", { text: win.open || !state.lastInboundAt ? "Les messages automatiques ne sont permis que dans les 24 h qui suivent le dernier message du prospect." : "Seul un humain peut encore écrire (message manuel de l'équipe)." }),
    ),
  );
}

function renderFichePanel() {
  const panel = $("fiche-panel");
  const f = state.lead.fiche;
  const rows: Node[] = [];
  for (const [key, label] of FIELD_LABELS) {
    const v = f[key];
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) continue;
    rows.push(h("dt", { text: label }), h("dd", { class: freshKeys.has(key) ? "fresh" : "", text: fieldValue(key, v) }));
  }
  const status = rt.ebaucheStatus(state, now());
  if (status && state.ebauche) {
    rows.push(h("dt", { text: "Ébauche" }), h("dd", { text: status === "prete" ? "prête, à montrer pendant l'appel" : `en préparation (prête vers ${fmtTime(state.ebauche.readyAt)})` }));
  }
  if (state.lead.rdv_note) rows.push(h("dt", { text: "Rendez-vous" }), h("dd", { text: state.lead.rdv_note }));
  if (state.lead.next_action) rows.push(h("dt", { text: "À faire" }), h("dd", { text: state.lead.next_action }));
  freshKeys = new Set();
  const { manquants } = ficheAdvice(f, state.lead.budget_status, !!state.lead.ebauche_id);
  const terminal = TERMINAL.includes(state.lead.stage) || state.lead.stage === "rdv_pris";
  fill(panel, 
    h("h2", {}, "Fiche prospect", h("small", { text: "remplie par Nova" })),
    rows.length ? h("dl", {}, ...rows) : h("p", { class: "empty", text: "Vide pour l'instant : Nova la remplit au fil de la conversation (outil maj_fiche)." }),
    manquants.length && !terminal ? h("div", { class: "todo" }, "À découvrir :", ...manquants.map((m) => h("span", { text: m }))) : null,
  );
}

function renderJournal() {
  const panel = $("journal-panel");
  const entries = [
    ...state.events.map((e) => {
      const detail = e.type === "fiche" && e.detail ? e.detail.split(", ").map((k) => FIELD_LABELS.find(([f]) => f === k)?.[1].toLowerCase() ?? k).join(", ") : e.detail;
      return { at: e.at, node: h("li", { class: e.tone }, h("div", {}, e.label, detail ? h("small", { text: detail }) : null), h("time", { text: fmtTime(e.at) })) };
    }),
    ...state.notifications.map((n) => ({
      at: n.at + 0.1,
      node: h("li", { class: `alert${n.urgent ? " urgent" : ""}` }, h("div", {}, h("b", { text: `${n.urgent ? "Alerte urgente" : "Alerte"} à l'équipe` }), h("small", { text: `${n.titre.replace(/^\[Labo\] /, "")}\n${n.corps}` })), h("time", { text: fmtTime(n.at) })),
    })),
  ].sort((a, b) => b.at - a.at);
  panel.replaceChildren(
    h("h2", {}, "Journal", h("small", { text: "ce que le moteur enregistre et envoie à l'équipe" })),
    entries.length ? h("ol", {}, ...entries.map((e) => e.node)) : h("p", { class: "empty", text: "Les actions de Nova (fiche, budget, ébauche, rendez-vous) et les alertes envoyées à l'équipe s'affichent ici." }),
  );
}

function renderAnalysePanel() {
  const panel = $("analyse-panel");
  const a = state.analyse;
  const running = job?.kind === "analyse";
  const content: Node[] = [
    h("h2", {}, "Analyse pour l'équipe", h("small", { text: "prompt « après »" })),
    h("div", { class: "row-btns" }, h("button", { type: "button", class: "ghost", text: running ? "Analyse en cours…" : a ? "Analyser à nouveau" : "Analyser la conversation", disabled: !sample || !!job || rt.sentMessages(state).length < 2, onclick: () => void runAnalyse() })),
  ];
  if (a) {
    const box = h(
      "div",
      { class: "analyse-out" },
      h("div", { class: "pills" }, h("span", { class: `pill ${a.temperature}`, text: TEMP_LABELS[a.temperature] })),
      h("p", { text: a.resume }),
      h("h3", { text: "Prochaine action" }),
      h("p", { text: a.prochaine_action }),
    );
    if (a.relance_manuelle) {
      const text = h("div", { class: "copyable", id: "relance-manuelle", text: a.relance_manuelle });
      box.append(
        h("h3", { text: "Relance manuelle prête à envoyer" }),
        text,
        h("div", { class: "row-btns" }, h("button", { type: "button", class: "mini", text: "Copier", onclick: (e: Event) => void copyText(a.relance_manuelle, e.currentTarget as HTMLButtonElement, text) })),
      );
    }
    if (a.signaux.length) box.append(h("h3", { text: "Signaux d'achat" }), h("ul", {}, ...a.signaux.map((s) => h("li", { text: s }))));
    if (a.risques.length) box.append(h("h3", { text: "Risques" }), h("ul", {}, ...a.risques.map((s) => h("li", { text: s }))));
    content.push(box);
  } else {
    content.push(h("p", { class: "empty", text: "En production, le moteur résume chaque conversation 30 minutes après le dernier échange : température, prochaine action et relance manuelle prête à copier." }));
  }
  panel.replaceChildren(...content);
}

async function copyText(text: string, button: HTMLButtonElement, source: HTMLElement) {
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copié";
  } catch {
    const range = document.createRange();
    range.selectNodeContents(source);
    const sel = getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    button.textContent = "Texte sélectionné";
  }
}

function renderSharePanel() {
  const panel = $("share-panel");
  if (!db || !canWrite) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const area = h("textarea", { id: "share-note", placeholder: "Ce qu'il faut retenir de cet essai (facultatif)", "aria-label": "Note sur l'essai" }) as HTMLTextAreaElement;
  area.value = shareNote;
  area.addEventListener("input", () => (shareNote = area.value));
  panel.replaceChildren(
    h("h2", {}, "Partager l'essai", h("small", { text: "pour améliorer le prompt" })),
    h("div", { class: "avis-form", style: "width:100%" }, area),
    h(
      "div",
      { class: "row-btns", style: "margin-top:8px" },
      h("button", { type: "button", class: "ghost", text: shareSaved ? "Essai enregistré" : "Enregistrer l'essai", disabled: shareSaved || !!job || rt.sentMessages(state).length < 2, onclick: () => void shareEssai() }),
    ),
    h("p", { class: "empty", style: "margin-top:8px", text: "La conversation, la fiche et ta note sont enregistrées avec la version du prompt : Claude les relit pour corriger ce qui cloche." }),
  );
}

function renderPromptPanel() {
  $("prompt-pre").textContent = data.prompts.conversation;
  $("context-pre").textContent = lastContext ? `Dernier contexte envoyé à Nova :\n\n${lastContext}` : "Le contexte envoyé à Nova (heure, étape, fiche, profil) apparaît ici après sa première réponse.";
  const booking = $<HTMLInputElement>("booking");
  if (document.activeElement !== booking) booking.value = settings.bookingUrl;
}

function renderDossier() {
  renderStagePanel();
  renderFichePanel();
  renderJournal();
  renderAnalysePanel();
  renderSharePanel();
}

function renderAll() {
  renderScenarios();
  renderContact();
  renderThread();
  renderDossier();
  renderPromptPanel();
  renderControls();
  renderBanner();
}

/* ------------------------------ Démarrage ------------------------------ */

function bindEvents() {
  const thread = $("thread");
  thread.addEventListener("scroll", () => {
    stickToBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
  });
  const draft = $<HTMLTextAreaElement>("draft");
  const grow = () => {
    draft.style.height = "auto";
    draft.style.height = `${Math.min(140, draft.scrollHeight)}px`;
  };
  draft.addEventListener("input", grow);
  draft.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      $<HTMLFormElement>("composer").requestSubmit();
    }
  });
  $<HTMLFormElement>("composer").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = draft.value;
    if (!text.trim()) return;
    draft.value = "";
    grow();
    sendProspect(text);
  });
  $("persona-btn").addEventListener("click", () => void askPersona());
  $("nova-btn").addEventListener("click", () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = null;
    void runNova();
  });
  $("silence-btn").addEventListener("click", () => void simulateSilence());
  $("stop-btn").addEventListener("click", () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    job?.ctl.abort();
    if (delivering) {
      const { replyId, ctl } = delivering;
      ctl.abort();
      revealed.delete(replyId);
    }
    typing = false;
    setStatus("Arrêté.");
    renderAll();
  });
  $("undo-btn").addEventListener("click", () => {
    interrupt();
    job?.ctl.abort();
    const previous = undoStack.pop();
    if (!previous) return;
    state = previous;
    revealed.clear();
    notes = notes.filter((n) => n.t <= now());
    for (const id of [...variants.keys()]) if (!state.replies.some((r) => r.id === id)) variants.delete(id);
    seen = false;
    shareSaved = false;
    setStatus("Retour à l'étape précédente.");
    persist();
    renderAll();
  });
  $("reset-btn").addEventListener("click", () => selectScenario(scenarioById(state.scenarioId)));
  const booking = $<HTMLInputElement>("booking");
  booking.addEventListener("change", () => {
    settings.bookingUrl = booking.value.trim();
    persist();
  });
}

async function initCapabilities() {
  const runtime = window.claude;
  if (!runtime?.use) {
    sampleState = "absent";
    renderBanner();
    renderControls();
    return;
  }
  void runtime.use("permissions").then((p) => (permissions = (p as PermissionsCap | null) ?? null)).catch(() => undefined);
  void runtime
    .use("sample")
    .then((s) => {
      sample = (s as SampleFn | null) ?? null;
      sampleState = sample ? "ready" : "absent";
    })
    .catch(() => (sampleState = "absent"))
    .finally(() => {
      renderBanner();
      renderAll();
      setStatus(sample && rt.awaitingNova(state) ? `Clique sur « Faire répondre ${NOVA} » : la première réponse demande ton accord pour utiliser Claude.` : "");
    });
  try {
    db = ((await runtime.use("db")) as DbCap | null) ?? null;
    user = ((await runtime.use("user")) as UserCap | null) ?? null;
    const allowed = user ? await user.can("data.write") : null;
    canWrite = !!db && allowed !== false;
  } catch {
    db = null;
    canWrite = false;
  }
  renderThread();
  renderDossier();
}

function boot() {
  if (!restore()) state = rt.newState(SCENARIOS[0]!, Date.now());
  bindEvents();
  renderHeader();
  renderAll();
  setStatus("Chargement de Claude…");
  void initCapabilities();
  setInterval(() => {
    renderClock();
    if (!job && !delivering) renderStagePanel();
  }, 20_000);
}

boot();
