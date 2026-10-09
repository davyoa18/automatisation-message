import type { Db } from "../client.js";
import type { Channel, Conversation, Source } from "../../domain.js";
import { newId } from "../../util/index.js";

export async function findConversation(db: Db, id: string): Promise<Conversation | undefined> {
  return db.one<Conversation>("SELECT * FROM conversations WHERE id = $1", [id]);
}

export async function latestConversationForContact(db: Db, contactId: string): Promise<Conversation | undefined> {
  return db.one<Conversation>(
    "SELECT * FROM conversations WHERE contact_id = $1 ORDER BY created_at DESC LIMIT 1",
    [contactId],
  );
}

/**
 * Une seule conversation vivante par contact : on la réutilise (la mémoire de la relation
 * vit dans la fiche du lead), et on n'en crée une nouvelle que si la précédente est fermée.
 */
export async function getOrCreateConversation(
  db: Db,
  contactId: string,
  channel: Channel,
  source: Source,
  sourceRef: string | null = null,
): Promise<{ conversation: Conversation; created: boolean }> {
  const existing = await db.one<Conversation>(
    "SELECT * FROM conversations WHERE contact_id = $1 AND status = 'ouverte' ORDER BY created_at DESC LIMIT 1",
    [contactId],
  );
  if (existing) return { conversation: existing, created: false };
  const row = await db.one<Conversation>(
    `INSERT INTO conversations (id, contact_id, channel, source, source_ref)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [newId(), contactId, channel, source, sourceRef],
  );
  if (!row) throw new Error("Création de la conversation impossible");
  return { conversation: row, created: true };
}

export async function touchInbound(db: Db, id: string, at: Date): Promise<void> {
  await db.query(
    "UPDATE conversations SET last_inbound_at = GREATEST(COALESCE(last_inbound_at, $2), $2), relances_sent = 0, updated_at = now() WHERE id = $1",
    [id, at],
  );
}

export async function touchOutbound(db: Db, id: string, at: Date): Promise<void> {
  await db.query("UPDATE conversations SET last_outbound_at = $2, updated_at = now() WHERE id = $1", [id, at]);
}

export async function incrementAiTurns(db: Db, id: string): Promise<void> {
  await db.query("UPDATE conversations SET ai_turns = ai_turns + 1, updated_at = now() WHERE id = $1", [id]);
}

export async function incrementRelances(db: Db, id: string): Promise<void> {
  await db.query("UPDATE conversations SET relances_sent = relances_sent + 1, updated_at = now() WHERE id = $1", [id]);
}

export async function pauseAi(db: Db, id: string, until: Date | null): Promise<void> {
  await db.query("UPDATE conversations SET ai_paused_until = $2, updated_at = now() WHERE id = $1", [id, until]);
}

export async function closeConversation(db: Db, id: string): Promise<void> {
  await db.query("UPDATE conversations SET status = 'fermee', updated_at = now() WHERE id = $1", [id]);
}

export interface ConversationListItem extends Conversation {
  username: string | null;
  name: string | null;
  profile_pic: string | null;
  stage: string | null;
  score: number | null;
  temperature: string | null;
  last_text: string | null;
  last_author: string | null;
  last_at: Date | null;
}

export async function listConversations(
  db: Db,
  opts: { limit?: number; stage?: string; search?: string; channel?: Channel } = {},
): Promise<ConversationListItem[]> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (opts.stage) {
    params.push(opts.stage);
    where.push(`l.stage = $${params.length}`);
  }
  if (opts.channel) {
    params.push(opts.channel);
    where.push(`c.channel = $${params.length}`);
  }
  if (opts.search) {
    params.push(`%${opts.search.toLowerCase()}%`);
    where.push(
      `(lower(coalesce(ct.username,'')) LIKE $${params.length} OR lower(coalesce(ct.name,'')) LIKE $${params.length} OR lower(coalesce(l.fiche->>'projet','')) LIKE $${params.length})`,
    );
  }
  params.push(opts.limit ?? 100);
  return db.query<ConversationListItem>(
    `SELECT c.*, ct.username, ct.name, ct.profile_pic, l.stage, l.score, l.temperature,
            m.text AS last_text, m.author AS last_author, m.created_at AS last_at
       FROM conversations c
       JOIN contacts ct ON ct.id = c.contact_id
       LEFT JOIN leads l ON l.contact_id = c.contact_id
       LEFT JOIN LATERAL (
         SELECT text, author, created_at FROM messages
          WHERE conversation_id = c.id AND status <> 'annule'
          ORDER BY created_at DESC LIMIT 1
       ) m ON true
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY COALESCE(m.created_at, c.created_at) DESC
      LIMIT $${params.length}`,
    params,
  );
}
