import type { BudgetStatus, Fiche, Stage, Temperature } from "../domain.js";

/** Champs que l'IA peut renseigner via l'outil `maj_fiche`. */
export interface FichePatch extends Fiche {
  budget_suffisant?: "oui" | "non" | "incertain";
}

const ARRAY_KEYS = ["fonctionnalites", "financement", "objections", "signaux"] as const;

function uniqMerge(a: string[] = [], b: string[] = [], max = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of [...a, ...b]) {
    const s = String(v).trim();
    const k = s.toLowerCase();
    if (!s || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out.slice(-max);
}

/** Fusionne une mise à jour dans la fiche sans jamais effacer une information déjà connue. */
export function mergeFiche(current: Fiche, patch: FichePatch): Fiche {
  const next: Fiche = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (key === "budget_suffisant" || value === undefined || value === null) continue;
    if ((ARRAY_KEYS as readonly string[]).includes(key)) {
      const k = key as (typeof ARRAY_KEYS)[number];
      next[k] = uniqMerge(current[k] as string[] | undefined, Array.isArray(value) ? (value as string[]) : [String(value)]);
      continue;
    }
    if (key === "notes") {
      const note = String(value).trim();
      if (!note) continue;
      const merged = current.notes ? `${current.notes} · ${note}` : note;
      next.notes = merged.length > 800 ? merged.slice(merged.length - 800) : merged;
      continue;
    }
    if (typeof value === "string" && !value.trim()) continue;
    (next as Record<string, unknown>)[key] = typeof value === "string" ? value.trim() : value;
  }
  return next;
}

export function deriveBudgetStatus(
  fiche: Fiche,
  declared: FichePatch["budget_suffisant"],
  previous: BudgetStatus,
  minimum: number,
): BudgetStatus {
  if (typeof fiche.budget_estime_eur === "number" && fiche.budget_estime_eur > 0) {
    return fiche.budget_estime_eur >= minimum ? "ok" : "insuffisant";
  }
  if (declared === "oui") return "ok";
  if (declared === "non") return "insuffisant";
  if (declared === "incertain") return previous === "ok" ? "ok" : "a_confirmer";
  return previous;
}

const SOLID_FUNDING = ["fonds_propres", "love_money", "pret_honneur", "subvention", "levee_de_fonds", "chiffre_affaires", "pret_bancaire"];

export interface ScoreInput {
  fiche: Fiche;
  budget: BudgetStatus;
  stage: Stage;
  hasEmail?: boolean;
}

/** Score de 0 à 100 : probabilité qu'un appel qualifié ait lieu et débouche. */
export function computeScore({ fiche, budget, stage, hasEmail }: ScoreInput): number {
  if (stage === "desinscrit") return 0;
  let s = 0;
  if (budget === "ok") s += 40;
  else if (budget === "a_confirmer") s += 12;
  if ((fiche.financement ?? []).some((f) => SOLID_FUNDING.includes(f))) s += 10;
  const features = fiche.fonctionnalites?.length ?? 0;
  if (fiche.description && features >= 2) s += 15;
  else if (fiche.description || fiche.projet) s += 7;
  if (fiche.echeance) s += 8;
  if (fiche.decisionnaire) s += 5;
  if (fiche.stade_projet && ["prototype", "app_existante", "business_existant"].includes(fiche.stade_projet)) s += 5;
  if (hasEmail || fiche.email) s += 5;
  if (stage === "ebauche") s += 5;
  if (stage === "rdv_propose") s += 8;
  if (stage === "rdv_pris" || stage === "gagne") s += 20;
  if (budget === "insuffisant") s = Math.min(s, 15);
  if (stage === "non_qualifie" || stage === "perdu") s = Math.min(s, 20);
  return Math.max(0, Math.min(100, s));
}

export function computeTemperature(score: number, budget: BudgetStatus, stage: Stage): Temperature {
  if (stage === "desinscrit" || stage === "non_qualifie" || stage === "perdu" || budget === "insuffisant") return "froid";
  if (stage === "rdv_pris" || stage === "gagne" || (budget === "ok" && stage === "rdv_propose")) return "brulant";
  if (budget === "ok" || score >= 50) return "chaud";
  if (score >= 20) return "tiede";
  return "froid";
}

const RANK: Record<Stage, number> = {
  nouveau: 0,
  decouverte: 1,
  a_relancer: 1,
  qualification: 2,
  qualifie: 3,
  ebauche: 4,
  rdv_propose: 5,
  rdv_pris: 6,
  gagne: 7,
  perdu: 7,
  non_qualifie: 7,
  desinscrit: 9,
};
const TERMINAL: Stage[] = ["gagne", "perdu", "non_qualifie", "desinscrit"];

/**
 * Fait avancer l'étape dans l'entonnoir sans jamais reculer, sauf vers une étape terminale
 * explicite (clôture, désinscription). Une personne désinscrite le reste.
 */
export function advanceStage(current: Stage, target: Stage): Stage {
  if (current === "desinscrit") return current;
  if (TERMINAL.includes(target)) return target;
  if (TERMINAL.includes(current) && target !== "decouverte") {
    // Un prospect clôturé qui revient avec un budget peut être réactivé.
    return RANK[target] >= RANK.qualifie ? target : current;
  }
  return RANK[target] > RANK[current] ? target : current;
}

/** Étape minimale suggérée par le contenu de la fiche. */
export function stageFromFiche(fiche: Fiche, budget: BudgetStatus): Stage {
  if (budget === "ok") return "qualifie";
  if (budget === "a_confirmer" || fiche.budget_declare) return "qualification";
  if (fiche.projet || fiche.description || fiche.prenom) return "decouverte";
  return "nouveau";
}
