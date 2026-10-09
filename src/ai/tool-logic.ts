/**
 * Logique des outils de l'IA sans base de données : validation de la fiche, étape suivante
 * conseillée et consignes renvoyées au modèle. Partagée par le moteur (src/ai/tools.ts) et par
 * le Labo (labo/), pour que les deux guident l'IA avec exactement les mêmes mots.
 */
import { z } from "zod";
import type { BudgetStatus, Fiche, Stage } from "../domain.js";
import type { FichePatch } from "./scoring.js";

const FichePatchSchema = z
  .object({
    prenom: z.string(),
    projet: z.string(),
    description: z.string(),
    cible: z.string(),
    probleme: z.string(),
    fonctionnalites: z.array(z.string()),
    stade_projet: z.enum(["idee", "maquette", "prototype", "app_existante", "business_existant", "autre"]),
    role: z.string(),
    societe_creee: z.boolean(),
    financement: z.array(z.string()),
    montant_leve_eur: z.coerce.number(),
    budget_declare: z.string(),
    budget_estime_eur: z.coerce.number(),
    budget_suffisant: z.enum(["oui", "non", "incertain"]),
    paiement_plusieurs_fois: z.boolean(),
    echeance: z.string(),
    decisionnaire: z.boolean(),
    email: z.string(),
    telephone: z.string(),
    site_web: z.string(),
    objections: z.array(z.string()),
    signaux: z.array(z.string()),
    notes: z.string(),
  })
  .partial();

/** Garde ce qui est valide champ par champ : une valeur mal typée ne fait pas perdre les autres. */
export function lenientFiche(input: Record<string, unknown>): FichePatch {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    const one = FichePatchSchema.safeParse({ [k]: v });
    if (one.success && k in one.data) out[k] = (one.data as Record<string, unknown>)[k];
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
