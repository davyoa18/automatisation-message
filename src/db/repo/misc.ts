import type { Db } from "../client.js";
import { toBuffer } from "../client.js";
import type { Ebauche, EbaucheBrief, Prospect } from "../../domain.js";
import { newId, secretId } from "../../util/index.js";

/* ------------------------------ Événements ------------------------------ */

export async function logEvent(
  db: Db,
  type: string,
  data: Record<string, unknown> = {},
  refs: { contactId?: string | null; conversationId?: string | null } = {},
): Promise<void> {
  await db.query("INSERT INTO events (contact_id, conversation_id, type, data) VALUES ($1, $2, $3, $4::jsonb)", [
    refs.contactId ?? null,
    refs.conversationId ?? null,
    type,
    JSON.stringify(data),
  ]);
}

export interface EventRow {
  id: number;
  contact_id: string | null;
  conversation_id: string | null;
  type: string;
  data: Record<string, unknown>;
  created_at: Date;
}

export async function listEvents(db: Db, opts: { contactId?: string; types?: string[]; limit?: number } = {}): Promise<EventRow[]> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (opts.contactId) {
    params.push(opts.contactId);
    where.push(`contact_id = $${params.length}`);
  }
  if (opts.types?.length) {
    params.push(opts.types);
    where.push(`type = ANY($${params.length}::text[])`);
  }
  params.push(opts.limit ?? 50);
  return db.query<EventRow>(
    `SELECT * FROM events ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  );
}

/* ------------------------------ Coûts IA ------------------------------ */

export async function recordUsage(
  db: Db,
  u: {
    purpose: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
    cost_usd: number;
    conversation_id?: string | null;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO llm_usage (purpose, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, conversation_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [u.purpose, u.model, u.input_tokens, u.output_tokens, u.cache_read_tokens, u.cache_write_tokens, u.cost_usd, u.conversation_id ?? null],
  );
}

export async function usageSince(db: Db, since: Date): Promise<{ purpose: string; model: string; calls: number; cost_usd: number }[]> {
  return db.query(
    `SELECT purpose, model, count(*)::int AS calls, coalesce(sum(cost_usd), 0)::float AS cost_usd
       FROM llm_usage WHERE created_at >= $1 GROUP BY purpose, model ORDER BY cost_usd DESC`,
    [since],
  );
}

export async function totalCostSince(db: Db, since: Date): Promise<number> {
  const row = await db.one<{ total: number }>("SELECT coalesce(sum(cost_usd), 0)::float AS total FROM llm_usage WHERE created_at >= $1", [
    since,
  ]);
  return row?.total ?? 0;
}

/* ------------------------------ Médias ------------------------------ */

export async function storeMedia(db: Db, contentType: string, bytes: Buffer): Promise<string> {
  const id = secretId();
  await db.query("INSERT INTO media (id, content_type, bytes) VALUES ($1, $2, $3)", [id, contentType, bytes]);
  return id;
}

export async function getMedia(db: Db, id: string): Promise<{ content_type: string; bytes: Buffer } | undefined> {
  const row = await db.one<{ content_type: string; bytes: unknown }>("SELECT content_type, bytes FROM media WHERE id = $1", [id]);
  if (!row) return undefined;
  return { content_type: row.content_type, bytes: toBuffer(row.bytes) };
}

/* ------------------------------ Ébauches ------------------------------ */

export async function createEbauche(
  db: Db,
  e: { contact_id: string; conversation_id: string | null; input: Record<string, unknown> },
): Promise<Ebauche> {
  const row = await db.one<Ebauche>(
    "INSERT INTO ebauches (id, contact_id, conversation_id, input) VALUES ($1, $2, $3, $4::jsonb) RETURNING *",
    [newId(), e.contact_id, e.conversation_id, JSON.stringify(e.input)],
  );
  if (!row) throw new Error("Création de l'ébauche impossible");
  return row;
}

export async function getEbauche(db: Db, id: string): Promise<Ebauche | undefined> {
  return db.one<Ebauche>("SELECT * FROM ebauches WHERE id = $1", [id]);
}

export async function updateEbauche(
  db: Db,
  id: string,
  p: { status?: Ebauche["status"]; brief?: EbaucheBrief; screens?: Ebauche["screens"]; media_ids?: string[]; error?: string | null },
): Promise<void> {
  await db.query(
    `UPDATE ebauches SET
       status = COALESCE($2, status),
       brief = COALESCE($3::jsonb, brief),
       screens = COALESCE($4::jsonb, screens),
       media_ids = COALESCE($5::jsonb, media_ids),
       error = $6,
       updated_at = now()
     WHERE id = $1`,
    [
      id,
      p.status ?? null,
      p.brief ? JSON.stringify(p.brief) : null,
      p.screens ? JSON.stringify(p.screens) : null,
      p.media_ids ? JSON.stringify(p.media_ids) : null,
      p.error ?? null,
    ],
  );
}

export async function listEbauches(db: Db, limit = 50): Promise<(Ebauche & { username: string | null; name: string | null })[]> {
  return db.query(
    `SELECT e.*, c.username, c.name FROM ebauches e LEFT JOIN contacts c ON c.id = e.contact_id
      ORDER BY e.created_at DESC LIMIT $1`,
    [limit],
  );
}

/* ------------------------------ Prospects ------------------------------ */

export interface NewProspect {
  source: string;
  source_ref: string;
  company_name?: string | null;
  person_name?: string | null;
  siren?: string | null;
  creation_date?: string | null;
  city?: string | null;
  sector?: string | null;
  description?: string | null;
  instagram?: string | null;
  website?: string | null;
  linkedin?: string | null;
  signals?: string[];
  notes?: string | null;
}

/** Ajoute un prospect s'il est nouveau (source + référence) ; renvoie undefined s'il existait. */
export async function insertProspect(db: Db, p: NewProspect): Promise<Prospect | undefined> {
  return db.one<Prospect>(
    `INSERT INTO prospects (id, source, source_ref, company_name, person_name, siren, creation_date, city, sector, description,
                            instagram, website, linkedin, signals, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15)
     ON CONFLICT (source, source_ref) DO NOTHING
     RETURNING *`,
    [
      newId(),
      p.source,
      p.source_ref,
      p.company_name ?? null,
      p.person_name ?? null,
      p.siren ?? null,
      p.creation_date ?? null,
      p.city ?? null,
      p.sector ?? null,
      p.description ?? null,
      p.instagram ? p.instagram.replace(/^@/, "") : null,
      p.website ?? null,
      p.linkedin ?? null,
      JSON.stringify(p.signals ?? []),
      p.notes ?? null,
    ],
  );
}

export async function getProspect(db: Db, id: string): Promise<Prospect | undefined> {
  return db.one<Prospect>("SELECT * FROM prospects WHERE id = $1", [id]);
}

export async function updateProspect(
  db: Db,
  id: string,
  p: Partial<Pick<Prospect, "score" | "score_reason" | "opener" | "status" | "instagram" | "notes" | "contact_id">> & {
    contacted?: boolean;
  },
): Promise<void> {
  await db.query(
    `UPDATE prospects SET
       score = COALESCE($2, score),
       score_reason = COALESCE($3, score_reason),
       opener = COALESCE($4, opener),
       status = COALESCE($5, status),
       instagram = COALESCE($6, instagram),
       notes = COALESCE($7, notes),
       contact_id = COALESCE($8, contact_id),
       contacted_at = CASE WHEN $9::boolean THEN now() ELSE contacted_at END,
       updated_at = now()
     WHERE id = $1`,
    [
      id,
      p.score ?? null,
      p.score_reason ?? null,
      p.opener ?? null,
      p.status ?? null,
      p.instagram ? p.instagram.replace(/^@/, "") : null,
      p.notes ?? null,
      p.contact_id ?? null,
      p.contacted ?? false,
    ],
  );
}

export async function listProspects(db: Db, opts: { status?: Prospect["status"][]; limit?: number } = {}): Promise<Prospect[]> {
  const params: unknown[] = [];
  let where = "";
  if (opts.status?.length) {
    params.push(opts.status);
    where = `WHERE status = ANY($1::text[])`;
  }
  params.push(opts.limit ?? 100);
  return db.query<Prospect>(
    `SELECT * FROM prospects ${where} ORDER BY score DESC, created_at DESC LIMIT $${params.length}`,
    params,
  );
}

export async function findProspectByInstagram(db: Db, username: string): Promise<Prospect | undefined> {
  return db.one<Prospect>("SELECT * FROM prospects WHERE lower(instagram) = $1 LIMIT 1", [username.replace(/^@/, "").toLowerCase()]);
}

/* ------------------------------ Retours (feedback) ------------------------------ */

export async function addFeedback(
  db: Db,
  f: { message_id?: string | null; conversation_id?: string | null; rating: number; comment?: string | null; author?: string | null },
): Promise<void> {
  await db.query("INSERT INTO feedback (message_id, conversation_id, rating, comment, author) VALUES ($1, $2, $3, $4, $5)", [
    f.message_id ?? null,
    f.conversation_id ?? null,
    f.rating,
    f.comment ?? null,
    f.author ?? null,
  ]);
}

export async function listFeedback(db: Db, limit = 100): Promise<Record<string, unknown>[]> {
  return db.query(
    `SELECT f.*, m.text AS message_text FROM feedback f LEFT JOIN messages m ON m.id = f.message_id
      ORDER BY f.created_at DESC LIMIT $1`,
    [limit],
  );
}

/* ------------------------------ Réglages ------------------------------ */

export async function getSetting<T>(db: Db, key: string): Promise<T | undefined> {
  const row = await db.one<{ value: T }>("SELECT value FROM settings WHERE key = $1", [key]);
  return row?.value;
}

export async function setSetting(db: Db, key: string, value: unknown): Promise<void> {
  await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

/* ------------------------------ Commentaires → DM ------------------------------ */

export interface CommentRule {
  id: string;
  media_id: string | null;
  keywords: string[];
  dm_text: string | null;
  public_reply: string | null;
  active: boolean;
  created_at: Date;
}

export async function listCommentRules(db: Db, activeOnly = true): Promise<CommentRule[]> {
  return db.query<CommentRule>(
    `SELECT * FROM comment_rules ${activeOnly ? "WHERE active" : ""} ORDER BY created_at`,
  );
}

export async function upsertCommentRule(
  db: Db,
  r: { id?: string; media_id?: string | null; keywords: string[]; dm_text?: string | null; public_reply?: string | null; active?: boolean },
): Promise<CommentRule> {
  const row = await db.one<CommentRule>(
    `INSERT INTO comment_rules (id, media_id, keywords, dm_text, public_reply, active)
     VALUES ($1, $2, $3::text[], $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET media_id = EXCLUDED.media_id, keywords = EXCLUDED.keywords,
       dm_text = EXCLUDED.dm_text, public_reply = EXCLUDED.public_reply, active = EXCLUDED.active
     RETURNING *`,
    [
      r.id ?? newId(),
      r.media_id ?? null,
      r.keywords.map((k) => k.trim().toUpperCase()).filter(Boolean),
      r.dm_text ?? null,
      r.public_reply ?? null,
      r.active ?? true,
    ],
  );
  if (!row) throw new Error("Règle de commentaire non enregistrée");
  return row;
}

export async function deleteCommentRule(db: Db, id: string): Promise<void> {
  await db.query("DELETE FROM comment_rules WHERE id = $1", [id]);
}

/** Réserve un commentaire (un seul message privé possible par commentaire). */
export async function claimComment(
  db: Db,
  c: { comment_id: string; rule_id: string | null; media_id: string | null; from_id: string | null; from_username: string | null; text: string },
): Promise<boolean> {
  const row = await db.one<{ comment_id: string }>(
    `INSERT INTO comment_replies (comment_id, rule_id, media_id, from_id, from_username, text)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (comment_id) DO NOTHING RETURNING comment_id`,
    [c.comment_id, c.rule_id, c.media_id, c.from_id, c.from_username, c.text],
  );
  return !!row;
}

export async function markCommentHandled(
  db: Db,
  commentId: string,
  p: { dm_sent?: boolean; public_replied?: boolean; error?: string | null },
): Promise<void> {
  await db.query(
    `UPDATE comment_replies SET dm_sent = COALESCE($2, dm_sent), public_replied = COALESCE($3, public_replied), error = $4
      WHERE comment_id = $1`,
    [commentId, p.dm_sent ?? null, p.public_replied ?? null, p.error ?? null],
  );
}

export async function findCommentReplyByUsername(db: Db, username: string): Promise<{ comment_id: string; media_id: string | null } | undefined> {
  return db.one(
    "SELECT comment_id, media_id FROM comment_replies WHERE lower(from_username) = $1 ORDER BY created_at DESC LIMIT 1",
    [username.replace(/^@/, "").toLowerCase()],
  );
}
