/**
 * Logique des outils de l'IA sans base de données : validation de la fiche, étape suivante
 * conseillée et consignes renvoyées au modèle. Partagée par le moteur (src/ai/tools.ts) et par
 * le Labo (labo/), pour que les deux guident l'IA avec exactement les mêmes mots.
 */
import type { BudgetStatus, Fiche, Stage } from "../domain.js";
import type { FichePatch } from "./scoring.js";

type FieldRule = "texte" | "textes" | "booleen" | "nombre" | readonly string[];

/** Type attendu de chaque champ de `maj_fiche` (sans dépendance : ce module tourne aussi dans le navigateur). */
const FICHE_RULES: Record<keyof FichePatch, FieldRule> = {
  prenom: "texte",
  projet: "texte",
  description: "texte",
  cible: "texte",
  probleme: "texte",
  fonctionnalites: "textes",
  plateformes: "texte",
  stade_projet: ["idee", "maquette", "prototype", "app_existante", "business_existant", "autre"],
  role: "texte",
  societe_creee: "booleen",
  financement: "textes",
  montant_leve_eur: "nombre",
  budget_declare: "texte",
  budget_estime_eur: "nombre",
  budget_suffisant: ["oui", "non", "incertain"],
  paiement_plusieurs_fois: "booleen",
  echeance: "texte",
  decisionnaire: "booleen",
  email: "texte",
  telephone: "texte",
  site_web: "texte",
  objections: "textes",
  signaux: "textes",
  notes: "texte",
};

function checkField(rule: FieldRule, value: unknown): { ok: true; value: unknown } | { ok: false } {
  if (Array.isArray(rule)) return typeof value === "string" && rule.includes(value) ? { ok: true, value } : { ok: false };
  switch (rule) {
    case "texte":
      return typeof value === "string" ? { ok: true, value } : { ok: false };
    case "textes":
      return Array.isArray(value) && value.every((v) => typeof v === "string") ? { ok: true, value } : { ok: false };
    case "booleen":
      return typeof value === "boolean" ? { ok: true, value } : { ok: false };
    case "nombre": {
      const n = typeof value === "number" ? value : typeof value === "string" || typeof value === "boolean" ? Number(value) : Number.NaN;
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
    }
  }
  return { ok: false };
}

/** Garde ce qui est valide champ par champ : une valeur mal typée ne fait pas perdre les autres. */
export function lenientFiche(input: Record<string, unknown>): FichePatch {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    const rule = (FICHE_RULES as Record<string, FieldRule | undefined>)[k];
    if (!rule || v === undefined) continue;
    const checked = checkField(rule, v);
    if (checked.ok) out[k] = checked.value;
  }
  return out as FichePatch;
}

/** Ce qu'il reste à découvrir et l'étape suivante conseillée, renvoyés au modèle après `maj_fiche`. */
export function ficheAdvice(fiche: Fiche, budget: BudgetStatus, ebaucheLancee: boolean): { manquants: string[]; suite: string } {
  const manquants: string[] = [];
  if (!fiche.description && !fiche.projet) manquants.push("ce que fait l'app");
  if (!fiche.cible) manquants.push("pour qui");
  if ((fiche.fonctionnalites?.length ?? 0) < 2) manquants.push("2 ou 3 fonctionnalités clés");
  if (budget === "inconnu" || budget === "a_confirmer") manquants.push("le budget");
  let suite: string;
  if (budget === "insuffisant") suite = "Budget insuffisant : fais une sortie élégante, puis clore_conversation.";
  else if (budget === "ok" && manquants.length === 0 && !ebaucheLancee) suite = "Projet clair et budget validé : lance l'ébauche (lancer_ebauche) puis propose l'appel.";
  else if (budget === "ok" && ebaucheLancee) suite = "Ébauche déjà lancée : propose l'appel (proposer_rdv) si ce n'est pas fait.";
  else suite = `À découvrir ensuite : ${manquants.join(", ")}.`;
  return { manquants, suite };
}

/** Les consignes que les outils renvoient au modèle. */
export const CONSIGNES = {
  ebaucheRefusee: (min: number) => `Budget non validé. Vérifie d'abord que la personne peut investir au moins ${min} € au total.`,
  ebaucheDejaLancee: "L'ébauche existe déjà : n'en relance pas une autre, propose l'appel.",
  ebaucheLancee: (dureeAppel: string) =>
    `Annonce que l'équipe prépare une première ébauche de son app, puis propose l'appel de ${dureeAppel} minutes (appelle proposer_rdv).`,
  rdvRefuse: (min: number) => `Budget non validé (minimum ${min} €). Qualifie le budget avant de proposer l'appel.`,
  rdvAvecLien: "Donne le lien tel quel, sans le modifier ni le raccourcir, et propose aussi 2 créneaux au choix. Si la personne choisit un créneau, utilise noter_rdv.",
  rdvSansLien:
    "Aucun lien de réservation configuré : propose 2 créneaux et demande lequel lui convient, puis enregistre son choix avec noter_rdv.",
  rdvNote: (avecEmail: boolean) =>
    `Confirme le créneau, dis que l'équipe envoie l'invitation${avecEmail ? " par email" : " (demande l'email si tu ne l'as pas)"}, et arrête de vendre.`,
  relaiHumain: "Dis que quelqu'un de l'équipe revient vers la personne très vite. Ne pose pas de nouvelle question.",
  desinscription: "Confirme en une phrase que tu ne lui écriras plus. Aucune question.",
  outilInconnu: (name: string) =>
    `Outil inconnu : ${name}. Outils disponibles : maj_fiche, lancer_ebauche, proposer_rdv, noter_rdv, passer_la_main, clore_conversation, desinscrire.`,
} as const;

/** Étape d'un prospect clôturé selon le motif. */
export function clotureStage(motif: string): Stage {
  return motif === "budget_insuffisant" || motif === "hors_cible" ? "non_qualifie" : "perdu";
}

/** Date du rendez-vous demandé, si le modèle l'a donnée au format ISO et qu'elle est dans le futur. */
export function parseRdvDate(quand: string, now: Date): Date | null {
  const parsed = Date.parse(quand);
  return Number.isFinite(parsed) && parsed > now.getTime() ? new Date(parsed) : null;
}
