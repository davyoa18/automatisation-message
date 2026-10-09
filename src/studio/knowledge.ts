import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "../config.js";

/** Racine du projet : le premier dossier parent qui contient `prompts/` et `studio/`. */
export function projectRoot(): string {
  if (process.env.PROJECT_ROOT) return process.env.PROJECT_ROOT;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, "prompts")) && existsSync(path.join(dir, "studio"))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

export interface StudioFacts {
  nom: string;
  site: string;
  assistant: string;
  pays: string;
  langue: string;
  budget_minimum_eur: number;
  paiement_plusieurs_fois: boolean;
  delai_livraison_jours: number;
  capacite_projets_par_mois: string;
  duree_appel_minutes: number;
  plateforme: string;
  taille_equipe: string;
  horaires_appels: string;
}

export interface Studio {
  facts: StudioFacts;
  vars: Record<string, string>;
  /** Base de connaissances complète (tous les fichiers studio/*.md), variables remplacées. */
  knowledge: string;
  /** Le fichier de cible seul (prompt de prospection). */
  cible: string;
  prompt(name: string, extra?: Record<string, string>): string;
}

export function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key: string) => (key in vars ? vars[key]! : match));
}

function stripComments(md: string): string {
  return md.replace(/<!--[\s\S]*?-->\n?/g, "");
}

export function loadStudio(cfg: Pick<Config, "STUDIO_NAME" | "ASSISTANT_NAME" | "BOOKING_URL">, root = projectRoot()): Studio {
  const studioDir = path.join(root, "studio");
  const facts = JSON.parse(readFileSync(path.join(studioDir, "studio.json"), "utf8")) as StudioFacts;
  const fmt = (n: number) => new Intl.NumberFormat("fr-FR").format(n).replace(/ /g, " ");
  const vars: Record<string, string> = {
    STUDIO_NAME: cfg.STUDIO_NAME || facts.nom,
    ASSISTANT_NAME: cfg.ASSISTANT_NAME || facts.assistant,
    STUDIO_SITE: facts.site,
    BUDGET_MIN: fmt(facts.budget_minimum_eur),
    DELAI_JOURS: String(facts.delai_livraison_jours),
    DUREE_APPEL: String(facts.duree_appel_minutes),
    CAPACITE: facts.capacite_projets_par_mois,
    HORAIRES_APPELS: facts.horaires_appels,
    BOOKING_URL: cfg.BOOKING_URL ?? "",
  };
  const files = readdirSync(studioDir)
    .filter((f) => f.endsWith(".md"))
    .sort();
  const sections = files.map((f) => render(stripComments(readFileSync(path.join(studioDir, f), "utf8")), vars).trim());
  const knowledge = sections.join("\n\n");
  const cibleFile = files.find((f) => f.includes("cible"));
  const cible = cibleFile ? render(stripComments(readFileSync(path.join(studioDir, cibleFile), "utf8")), vars).trim() : "";

  const promptCache = new Map<string, string>();
  return {
    facts,
    vars,
    knowledge,
    cible,
    prompt(name, extra = {}) {
      let raw = promptCache.get(name);
      if (raw === undefined) {
        raw = readFileSync(path.join(root, "prompts", `${name}.md`), "utf8");
        promptCache.set(name, raw);
      }
      return render(raw, { ...vars, KNOWLEDGE: knowledge, CIBLE: cible, ...extra }).trim();
    },
  };
}
