import type { Db } from "../client.js";
import type { Author, Direction, Message, MessageKind, MessageStatus } from "../../domain.js";
import { newId } from "../../util/index.js";

export interface NewMessage {
  conversation_id: string;
  direction: Direction;
  author: Author;
  kind?: MessageKind;
  text?: string | null;
  payload?: Record<string, unknown>;
  external_id?: string | null;
  status?: MessageStatus;
  created_at?: Date;
  sent_at?: Date | null;
}

/** Insère un message ; renvoie undefined si l'identifiant Instagram est déjà connu (webhook rejoué). */
export async function insertMessage(db: Db, m: NewMessage): Promise<Message | undefined> {
  return db.one<Message>(
    `INSERT INTO messages (id, conversation_id, direction, author, kind, text, payload, external_id, status, created_at, sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, COALESCE($10, now()), $11)
     ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO NOTHING
     RETURNING *`,
    [
      newId(),
      m.conversation_id,
      m.direction,
      m.author,
      m.kind ?? "texte",
      m.text ?? null,
      JSON.stringify(m.payload ?? {}),
      m.external_id ?? null,
      m.status ?? (m.direction === "entrant" ? "recu" : "planifie"),
      m.created_at ?? null,
      m.sent_at ?? null,
    ],
  );
}

export async function findMessage(db: Db, id: string): Promise<Message | undefined> {
  return db.one<Message>("SELECT * FROM messages WHERE id = $1", [id]);
}

export async function findMessageByExternal(db: Db, externalId: string): Promise<Message | undefined> {
  return db.one<Message>("SELECT * FROM messages WHERE external_id = $1", [externalId]);
}

/** Historique dans l'ordre chronologique (messages annulés exclus). */
export async function conversationHistory(db: Db, conversationId: string, limit = 60): Promise<Message[]> {
  const rows = await db.query<Message>(
    `SELECT * FROM (
       SELECT * FROM messages WHERE conversation_id = $1 AND status <> 'annule'
        ORDER BY created_at DESC LIMIT $2
     ) t ORDER BY created_at ASC`,
    [conversationId, limit],
  );
  return rows;
}

export async function markSent(db: Db, id: string, externalId: string | null, at: Date): Promise<void> {
  await db.query("UPDATE messages SET status = 'envoye', external_id = COALESCE($2, external_id), sent_at = $3, error = NULL WHERE id = $1", [
    id,
    externalId,
    at,
  ]);
}

export async function markFailed(db: Db, id: string, error: string): Promise<void> {
  await db.query("UPDATE messages SET status = 'echec', error = $2 WHERE id = $1", [id, error]);
}

export async function cancelPlannedMessages(db: Db, conversationId: string): Promise<number> {
  const rows = await db.query<{ id: string }>(
    "UPDATE messages SET status = 'annule' WHERE conversation_id = $1 AND status = 'planifie' RETURNING id",
    [conversationId],
  );
  return rows.length;
}

export async function lastInboundAt(db: Db, conversationId: string): Promise<Date | null> {
  const row = await db.one<{ at: Date | null }>(
    "SELECT max(created_at) AS at FROM messages WHERE conversation_id = $1 AND direction = 'entrant'",
    [conversationId],
  );
  return row?.at ?? null;
}
