import { z } from "zod";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import type { Prospect } from "../domain.js";
import type { Studio } from "../studio/knowledge.js";
import { type Llm, parseJsonLoose, textOf } from "../ai/llm.js";
import { getProspect, insertProspect, listProspects, logEvent, updateProspect, type NewProspect } from "../db/repo/misc.js";
import { enqueue } from "../db/repo/jobs.js";
import { fromRechercheEntreprises, fromRss } from "./sources.js";
import type { Clock } from "../util/index.js";
import { log } from "../logger.js";

const DEFAULT_QUERIES = ["application mobile", "app mobile", "startup application"];

const EvalZ = z.object({
  evaluations: z.array(z.object({ id: z.string(), score: z.coerce.number(), raison: z.string(), pertinent: z.boolean() })),
});
const OpenerZ = z.object({ accroches: z.array(z.object({ id: z.string(), message: z.string() })) });

const EVAL_SCHEMA = {
  type: "object",
  properties: {
    evaluations: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, score: { type: "number" }, raison: { type: "string" }, pertinent: { type: "boolean" } },
        required: ["id", "score", "raison", "pertinent"],
        additionalProperties: false,
      },
    },
  },
  required: ["evaluations"],
  additionalProperties: false,
};
const OPENER_SCHEMA = {
  type: "object",
  properties: {
    accroches: {
      type: "array",
      items: { type: "object", properties: { id: { type: "string" }, message: { type: "string" } }, required: ["id", "message"], additionalProperties: false },
    },
  },
  required: ["accroches"],
  additionalProperties: false,
};

function forPrompt(p: Prospect) {
  return {
    id: p.id,
    source: p.source,
    entreprise: p.company_name,
    personne: p.person_name,
    creee_le: p.creation_date ? new Date(p.creation_date).toISOString().slice(0, 10) : null,
    ville: p.city,
    secteur: p.sector,
    description: p.description,
    instagram: p.instagram,
    signaux: p.signals,
    notes: p.notes,
  };
}

/**
 * Prospection sortante assistée : l'IA repère, classe et rédige ; un humain envoie le premier
 * message lui-même. Aucun message n'est envoyé automatiquement à un inconnu.
 */
export class ProspectService {
  constructor(private d: { db: Db; cfg: Config; studio: Studio; llm: Llm | null; clock: Clock; fetchImpl?: typeof fetch }) {}

  async scan(): Promise<{ added: number; scored: number; openers: number; errors: string[] }> {
    const now = this.d.clock.now();
    const errors: string[] = [];
    const results = await Promise.all([
      fromRechercheEntreprises(DEFAULT_QUERIES, { now, fetchImpl: this.d.fetchImpl }),
      this.d.cfg.PROSPECTS_RSS.length ? fromRss(this.d.cfg.PROSPECTS_RSS, { now, fetchImpl: this.d.fetchImpl }) : Promise.resolve({ source: "actualite", prospects: [] as NewProspect[] }),
    ]);
    let added = 0;
    for (const r of results) {
      if ("error" in r && r.error) errors.push(`${r.source} : ${r.error}`);
      for (const p of r.prospects) if (await insertProspect(this.d.db, p)) added++;
    }
    const scored = await this.scorePending();
    const openers = await this.draftOpeners();
    await logEvent(this.d.db, "scan_prospects", { added, scored, openers, errors });
    if (openers > 0) {
      await enqueue(
        this.d.db,
        "notifier",
        { kind: "prospects", title: `${openers} prospect(s) à contacter aujourd'hui`, body: "Les accroches sont prêtes dans le cockpit, onglet Prospects.", urgent: false },
        { runAt: now },
      );
    }
    if (errors.length) log.warn("scan des prospects incomplet", { errors });
    return { added, scored, openers, errors };
  }

  /** Ajout manuel (un @ repéré par l'équipe, un contact d'événement…). */
  async addManual(p: { instagram?: string; company?: string; person?: string; notes?: string; website?: string }): Promise<Prospect | undefined> {
    const ref = (p.instagram || p.company || p.person || "").trim().toLowerCase();
    if (!ref) throw new Error("Indique au moins un @ Instagram, une entreprise ou un nom.");
    const row = await insertProspect(this.d.db, {
      source: "manuel",
      source_ref: ref,
      instagram: p.instagram ?? null,
      company_name: p.company ?? null,
      person_name: p.person ?? null,
      website: p.website ?? null,
      notes: p.notes ?? null,
      description: p.notes ?? null,
      signals: ["ajout_manuel"],
    });
    if (row) {
      await this.scorePending([row.id]);
      await this.draftOpeners([row.id]);
    }
    return row ? getProspect(this.d.db, row.id) : undefined;
  }

  async scorePending(onlyIds?: string[]): Promise<number> {
    if (!this.d.llm) return 0;
    let pending = await listProspects(this.d.db, { status: ["a_qualifier"], limit: 60 });
    if (onlyIds) pending = pending.filter((p) => onlyIds.includes(p.id));
    let n = 0;
    for (let i = 0; i < pending.length; i += 20) {
      const batch = pending.slice(i, i + 20);
      const res = await this.d.llm.create({
        purpose: "prospection",
        model: this.d.cfg.AI_MODEL_PROSPECTION,
        system: this.d.studio.prompt("prospection"),
        messages: [{ role: "user", content: `Prospects à évaluer :\n${JSON.stringify(batch.map(forPrompt), null, 2)}` }],
        outputSchema: EVAL_SCHEMA,
        effort: "low",
        maxTokens: 6000,
      });
      const parsed = EvalZ.safeParse(parseJsonLoose(textOf(res.content)));
      if (!parsed.success) continue;
      for (const e of parsed.data.evaluations) {
        if (!batch.some((b) => b.id === e.id)) continue;
        const score = Math.max(0, Math.min(100, Math.round(e.score)));
        await updateProspect(this.d.db, e.id, { score, score_reason: e.raison, status: e.pertinent && score >= 50 ? "a_contacter" : "ecarte" });
        n++;
      }
    }
    return n;
  }

  async draftOpeners(onlyIds?: string[]): Promise<number> {
    if (!this.d.llm) return 0;
    let todo = (await listProspects(this.d.db, { status: ["a_contacter"], limit: 30 })).filter((p) => !p.opener);
    if (onlyIds) todo = todo.filter((p) => onlyIds.includes(p.id));
    let n = 0;
    for (let i = 0; i < todo.length; i += 10) {
      const batch = todo.slice(i, i + 10);
      const res = await this.d.llm.create({
        purpose: "accroche",
        model: this.d.cfg.AI_MODEL_CONVERSATION,
        system: this.d.studio.prompt("accroche"),
        messages: [{ role: "user", content: `Prospects :\n${JSON.stringify(batch.map(forPrompt), null, 2)}` }],
        outputSchema: OPENER_SCHEMA,
        effort: "low",
        maxTokens: 6000,
      });
      const parsed = OpenerZ.safeParse(parseJsonLoose(textOf(res.content)));
      if (!parsed.success) continue;
      for (const a of parsed.data.accroches) {
        if (!batch.some((b) => b.id === a.id) || !a.message.trim()) continue;
        await updateProspect(this.d.db, a.id, { opener: a.message.trim().slice(0, 600) });
        n++;
      }
    }
    return n;
  }
}
