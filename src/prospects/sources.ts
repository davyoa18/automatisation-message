import { XMLParser } from "fast-xml-parser";
import type { NewProspect } from "../db/repo/misc.js";

/**
 * Sources publiques et légales de prospects. Aucune ne touche à Instagram : le scraping
 * d'Instagram est interdit par ses conditions d'utilisation.
 */

export interface SourceResult {
  source: string;
  prospects: NewProspect[];
  error?: string;
}

/** Registre national des entreprises (API publique « Recherche d'entreprises », data.gouv.fr). */
export async function fromRechercheEntreprises(
  queries: string[],
  opts: { now: Date; maxAgeDays?: number; fetchImpl?: typeof fetch },
): Promise<SourceResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxAge = (opts.maxAgeDays ?? 180) * 86_400_000;
  const prospects: NewProspect[] = [];
  try {
    for (const q of queries) {
      const url = new URL("https://recherche-entreprises.api.gouv.fr/search");
      url.searchParams.set("q", q);
      url.searchParams.set("per_page", "25");
      url.searchParams.set("page", "1");
      url.searchParams.set("etat_administratif", "A");
      const res = await fetchImpl(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { results?: Record<string, unknown>[] };
      for (const r of json.results ?? []) {
        const created = typeof r.date_creation === "string" ? Date.parse(r.date_creation) : NaN;
        if (!Number.isFinite(created) || opts.now.getTime() - created > maxAge) continue;
        const siege = (r.siege ?? {}) as Record<string, unknown>;
        const dirigeants = Array.isArray(r.dirigeants) ? (r.dirigeants as Record<string, unknown>[]) : [];
        const person = dirigeants.find((d) => d.type_dirigeant === "personne physique");
        const name = String(r.nom_complet ?? r.nom_raison_sociale ?? "").trim();
        if (!name || !r.siren) continue;
        prospects.push({
          source: "registre",
          source_ref: String(r.siren),
          company_name: name,
          person_name: person ? `${String(person.prenoms ?? "").split(" ")[0]} ${String(person.nom ?? "")}`.trim() : null,
          siren: String(r.siren),
          creation_date: String(r.date_creation),
          city: siege.libelle_commune ? String(siege.libelle_commune) : null,
          sector: r.activite_principale ? String(r.activite_principale) : null,
          description: `Société créée le ${String(r.date_creation)}${siege.libelle_commune ? ` à ${String(siege.libelle_commune)}` : ""}. Recherche : « ${q} ».`,
          signals: ["societe_recente"],
        });
      }
    }
    return { source: "registre", prospects };
  } catch (err) {
    return { source: "registre", prospects, error: (err as Error).message };
  }
}

/** Flux RSS d'actualité (levées de fonds, lancements). L'IA en extrait ensuite la startup concernée. */
export async function fromRss(feeds: string[], opts: { now: Date; maxAgeDays?: number; fetchImpl?: typeof fetch }): Promise<SourceResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxAge = (opts.maxAgeDays ?? 10) * 86_400_000;
  const parser = new XMLParser({ ignoreAttributes: true, processEntities: true, htmlEntities: true });
  const prospects: NewProspect[] = [];
  const errors: string[] = [];
  for (const feed of feeds) {
    try {
      const res = await fetchImpl(feed, { headers: { Accept: "application/rss+xml, application/xml, text/xml" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      const doc = parser.parse(xml) as Record<string, any>;
      const items: Record<string, unknown>[] = [].concat(doc?.rss?.channel?.item ?? doc?.feed?.entry ?? []);
      for (const it of items) {
        const title = String(it.title ?? "").trim();
        const link = typeof it.link === "string" ? it.link : String((it.link as Record<string, unknown>)?.href ?? it.guid ?? "");
        const date = Date.parse(String(it.pubDate ?? it.published ?? it.updated ?? ""));
        if (!title || !link) continue;
        if (Number.isFinite(date) && opts.now.getTime() - date > maxAge) continue;
        const desc = String(it.description ?? it.summary ?? "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 600);
        prospects.push({
          source: "actualite",
          source_ref: link,
          company_name: null,
          description: `${title} — ${desc}`,
          website: link,
          signals: /lev[ée]e|l[eè]ve|millions?|seed|financement|tour de table/i.test(title + desc) ? ["levee_de_fonds"] : ["actualite"],
        });
      }
    } catch (err) {
      errors.push(`${feed} : ${(err as Error).message}`);
    }
  }
  return { source: "actualite", prospects, error: errors.length ? errors.join(" ; ") : undefined };
}
