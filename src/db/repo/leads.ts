import type { Db } from "../client.js";
import type { BudgetStatus, Fiche, Lead, Stage, Temperature } from "../../domain.js";

export async function getLead(db: Db, contactId: string): Promise<Lead> {
  const row = await db.one<Lead>(
    `INSERT INTO leads (contact_id) VALUES ($1)
     ON CONFLICT (contact_id) DO UPDATE SET contact_id = EXCLUDED.contact_id
     RETURNING *`,
    [contactId],
  );
  if (!row) throw new Error("Lead introuvable");
  return row;
}

export interface LeadPatch {
  stage?: Stage;
  score?: number;
  temperature?: Temperature;
  budget_status?: BudgetStatus;
  fiche?: Fiche;
  summary?: string | null;
  next_action?: string | null;
  manual_followup?: string | null;
  ebauche_id?: string | null;
  rdv_at?: Date | null;
  rdv_note?: string | null;
  owner?: string | null;
}

const COLUMNS: (keyof LeadPatch)[] = [
  "stage",
  "score",
  "temperature",
  "budget_status",
  "fiche",
  "summary",
  "next_action",
  "manual_followup",
  "ebauche_id",
  "rdv_at",
  "rdv_note",
  "owner",
];

export async function updateLead(db: Db, contactId: string, patch: LeadPatch): Promise<Lead> {
  await getLead(db, contactId);
  const sets: string[] = [];
  const params: unknown[] = [contactId];
  for (const col of COLUMNS) {
    if (!(col in patch)) continue;
    const value = patch[col];
    params.push(col === "fiche" ? JSON.stringify(value ?? {}) : value);
    sets.push(col === "fiche" ? `fiche = $${params.length}::jsonb` : `${col} = $${params.length}`);
  }
  if (!sets.length) return getLead(db, contactId);
  const row = await db.one<Lead>(
    `UPDATE leads SET ${sets.join(", ")}, updated_at = now() WHERE contact_id = $1 RETURNING *`,
    params,
  );
  if (!row) throw new Error("Mise à jour du lead impossible");
  return row;
}

export interface LeadListItem extends Lead {
  username: string | null;
  name: string | null;
  conversation_id: string | null;
  last_inbound_at: Date | null;
}

export async function listLeads(
  db: Db,
  opts: { stages?: Stage[]; minScore?: number; limit?: number } = {},
): Promise<LeadListItem[]> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (opts.stages?.length) {
    params.push(opts.stages);
    where.push(`l.stage = ANY($${params.length}::text[])`);
  }
  if (opts.minScore !== undefined) {
    params.push(opts.minScore);
    where.push(`l.score >= $${params.length}`);
  }
  params.push(opts.limit ?? 50);
  return db.query<LeadListItem>(
    `SELECT l.*, ct.username, ct.name, cv.id AS conversation_id, cv.last_inbound_at
       FROM leads l
       JOIN contacts ct ON ct.id = l.contact_id
       LEFT JOIN LATERAL (
         SELECT id, last_inbound_at FROM conversations WHERE contact_id = l.contact_id ORDER BY created_at DESC LIMIT 1
       ) cv ON true
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY l.score DESC, l.updated_at DESC
      LIMIT $${params.length}`,
    params,
  );
}
