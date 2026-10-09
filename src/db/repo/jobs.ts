import type { Db } from "../client.js";
import type { Job, JobType } from "../../domain.js";
import { newId } from "../../util/index.js";

export interface EnqueueOptions {
  runAt: Date;
  /** Clé de dédoublonnage : au plus une tâche en attente par clé (une autre peut tourner en même temps). */
  dedupeKey?: string;
  /**
   * Si une tâche attend déjà pour la clé : la reprogrammer avec ce contenu (true), ou la garder (false).
   * Sans `replace`, une tâche de même clé en cours d'exécution suffit aussi : rien n'est ajouté.
   */
  replace?: boolean;
  /** File d'exécution : deux tâches de la même file ne tournent jamais en même temps. */
  lane?: string | null;
}

/** Les tâches qui écrivent au prospect passent par la file de leur conversation. */
const CONVERSATION_LANE_TYPES: ReadonlySet<JobType> = new Set(["repondre", "envoyer", "relancer"]);

export function laneFor(type: JobType, payload: Record<string, unknown>): string | null {
  return CONVERSATION_LANE_TYPES.has(type) && typeof payload.conversationId === "string" ? `conv:${payload.conversationId}` : null;
}

export async function enqueue(db: Db, type: JobType, payload: Record<string, unknown>, opts: EnqueueOptions): Promise<Job> {
  const lane = opts.lane !== undefined ? opts.lane : laneFor(type, payload);
  if (opts.dedupeKey) {
    const pending = await db.one<Job>("SELECT * FROM jobs WHERE dedupe_key = $1 AND status = 'en_attente' LIMIT 1", [opts.dedupeKey]);
    if (pending) {
      if (!opts.replace) return pending;
      const updated = await db.one<Job>(
        "UPDATE jobs SET run_at = $2, payload = $3::jsonb, updated_at = now() WHERE id = $1 AND status = 'en_attente' RETURNING *",
        [pending.id, opts.runAt, JSON.stringify(payload)],
      );
      if (updated) return updated;
      // Réservée entre-temps par le worker : on en programme une nouvelle ci-dessous.
    }
    if (!opts.replace) {
      const running = await db.one<Job>("SELECT * FROM jobs WHERE dedupe_key = $1 AND status = 'en_cours' LIMIT 1", [opts.dedupeKey]);
      if (running) return running;
    }
  }
  const row = await db.one<Job>(
    `INSERT INTO jobs (id, type, dedupe_key, payload, run_at, lane) VALUES ($1, $2, $3, $4::jsonb, $5, $6)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'en_attente' DO UPDATE SET
       run_at = CASE WHEN $7::boolean THEN EXCLUDED.run_at ELSE jobs.run_at END,
       payload = CASE WHEN $7::boolean THEN EXCLUDED.payload ELSE jobs.payload END,
       updated_at = now()
     RETURNING *`,
    [newId(), type, opts.dedupeKey ?? null, JSON.stringify(payload), opts.runAt, lane, !!opts.replace],
  );
  if (!row) throw new Error("Création de tâche impossible");
  return row;
}

/**
 * Réserve la prochaine tâche due. Une tâche attend si une autre de sa file (même conversation)
 * ou de sa clé tourne déjà : jamais deux réponses ni deux envois en parallèle pour un prospect.
 */
export async function claimNext(db: Db, now: Date): Promise<Job | undefined> {
  return db.one<Job>(
    `UPDATE jobs SET status = 'en_cours', locked_at = $1, attempts = attempts + 1, updated_at = now()
      WHERE id = (
        SELECT j.id FROM jobs j
         WHERE j.status = 'en_attente' AND j.run_at <= $1
           AND (j.lane IS NULL OR NOT EXISTS (SELECT 1 FROM jobs r WHERE r.lane = j.lane AND r.status = 'en_cours'))
           AND (j.dedupe_key IS NULL OR NOT EXISTS (SELECT 1 FROM jobs r WHERE r.dedupe_key = j.dedupe_key AND r.status = 'en_cours'))
         ORDER BY j.run_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      RETURNING *`,
    [now],
  );
}

/**
 * Remet une tâche en attente, sauf si une tâche de même clé attend déjà (elle fera le travail) :
 * celle-ci est alors annulée.
 */
const BACK_TO_PENDING = `CASE WHEN dedupe_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM jobs s WHERE s.dedupe_key = jobs.dedupe_key AND s.status = 'en_attente' AND s.id <> jobs.id
  ) THEN 'annule' ELSE 'en_attente' END`;

export async function completeJob(db: Db, id: string): Promise<void> {
  await db.query("UPDATE jobs SET status = 'fait', locked_at = NULL, updated_at = now() WHERE id = $1", [id]);
}

export async function failJob(db: Db, id: string, error: string, retryAt: Date | null): Promise<void> {
  if (retryAt) {
    await db.query(
      `UPDATE jobs SET status = ${BACK_TO_PENDING}, last_error = $2, run_at = $3, locked_at = NULL, updated_at = now() WHERE id = $1`,
      [id, error, retryAt],
    );
  } else {
    await db.query("UPDATE jobs SET status = 'echec', last_error = $2, locked_at = NULL, updated_at = now() WHERE id = $1", [
      id,
      error,
    ]);
  }
}

export async function cancelJobs(db: Db, where: { types?: JobType[]; conversationId?: string; dedupePrefix?: string }): Promise<number> {
  const params: unknown[] = [];
  const conds: string[] = ["status = 'en_attente'"];
  if (where.types?.length) {
    params.push(where.types);
    conds.push(`type = ANY($${params.length}::text[])`);
  }
  if (where.conversationId) {
    params.push(where.conversationId);
    conds.push(`payload->>'conversationId' = $${params.length}`);
  }
  if (where.dedupePrefix) {
    params.push(where.dedupePrefix + "%");
    conds.push(`dedupe_key LIKE $${params.length}`);
  }
  const rows = await db.query<{ id: string }>(
    `UPDATE jobs SET status = 'annule', updated_at = now() WHERE ${conds.join(" AND ")} RETURNING id`,
    params,
  );
  return rows.length;
}

/** Remet en file les tâches restées "en cours" sans signe de vie (arrêt brutal du serveur). */
export async function requeueStale(db: Db, olderThan: Date): Promise<number> {
  const rows = await db.query<{ id: string }>(
    `UPDATE jobs SET status = ${BACK_TO_PENDING}, locked_at = NULL, updated_at = now() WHERE status = 'en_cours' AND locked_at < $1 RETURNING id`,
    [olderThan],
  );
  return rows.length;
}

/** Signe de vie des tâches en cours d'exécution (évite qu'une tâche longue soit relancée en double). */
export async function heartbeatJobs(db: Db, ids: string[], now: Date): Promise<void> {
  if (!ids.length) return;
  await db.query("UPDATE jobs SET locked_at = $2 WHERE id = ANY($1::text[]) AND status = 'en_cours'", [ids, now]);
}

/** Rend à la file les tâches d'un worker qui s'arrête : elles reprendront au prochain démarrage. */
export async function releaseJobs(db: Db, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const rows = await db.query<{ id: string }>(
    `UPDATE jobs SET status = ${BACK_TO_PENDING}, locked_at = NULL, attempts = GREATEST(attempts - 1, 0), updated_at = now()
      WHERE id = ANY($1::text[]) AND status = 'en_cours' RETURNING id`,
    [ids],
  );
  return rows.length;
}

export async function pendingJobs(db: Db, conversationId: string): Promise<Job[]> {
  return db.query<Job>(
    "SELECT * FROM jobs WHERE status IN ('en_attente', 'en_cours') AND payload->>'conversationId' = $1 ORDER BY run_at",
    [conversationId],
  );
}

export async function nextRunAt(db: Db): Promise<Date | null> {
  const row = await db.one<{ at: Date | null }>("SELECT min(run_at) AS at FROM jobs WHERE status = 'en_attente'");
  return row?.at ?? null;
}
