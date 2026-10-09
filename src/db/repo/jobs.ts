import type { Db } from "../client.js";
import type { Job, JobType } from "../../domain.js";
import { newId } from "../../util/index.js";

export interface EnqueueOptions {
  runAt: Date;
  /** Clé de dédoublonnage : une seule tâche active par clé. */
  dedupeKey?: string;
  /** Si une tâche active existe déjà pour la clé : la reprogrammer (true) ou la garder (false). */
  replace?: boolean;
}

export async function enqueue(db: Db, type: JobType, payload: Record<string, unknown>, opts: EnqueueOptions): Promise<Job> {
  if (opts.dedupeKey) {
    const active = await db.one<Job>(
      "SELECT * FROM jobs WHERE dedupe_key = $1 AND status IN ('en_attente', 'en_cours') LIMIT 1",
      [opts.dedupeKey],
    );
    if (active) {
      if (opts.replace && active.status === "en_attente") {
        const row = await db.one<Job>(
          "UPDATE jobs SET run_at = $2, payload = $3::jsonb, updated_at = now() WHERE id = $1 RETURNING *",
          [active.id, opts.runAt, JSON.stringify(payload)],
        );
        return row ?? active;
      }
      if (!opts.replace || active.status === "en_cours") {
        if (active.status === "en_cours" && opts.replace) {
          // La tâche tourne déjà : on en programme une suivante, qui sera dédoublonnée à son tour.
          return insertJob(db, type, payload, opts.runAt, null);
        }
        return active;
      }
    }
  }
  return insertJob(db, type, payload, opts.runAt, opts.dedupeKey ?? null);
}

async function insertJob(db: Db, type: JobType, payload: Record<string, unknown>, runAt: Date, key: string | null): Promise<Job> {
  const row = await db.one<Job>(
    `INSERT INTO jobs (id, type, dedupe_key, payload, run_at) VALUES ($1, $2, $3, $4::jsonb, $5)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('en_attente', 'en_cours') DO UPDATE SET updated_at = now()
     RETURNING *`,
    [newId(), type, key, JSON.stringify(payload), runAt],
  );
  if (!row) throw new Error("Création de tâche impossible");
  return row;
}

/** Réserve la prochaine tâche due (sûr en multi-instances grâce à SKIP LOCKED). */
export async function claimNext(db: Db, now: Date): Promise<Job | undefined> {
  return db.one<Job>(
    `UPDATE jobs SET status = 'en_cours', locked_at = $1, attempts = attempts + 1, updated_at = now()
      WHERE id = (
        SELECT id FROM jobs WHERE status = 'en_attente' AND run_at <= $1
         ORDER BY run_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      RETURNING *`,
    [now],
  );
}

export async function completeJob(db: Db, id: string): Promise<void> {
  await db.query("UPDATE jobs SET status = 'fait', locked_at = NULL, updated_at = now() WHERE id = $1", [id]);
}

export async function failJob(db: Db, id: string, error: string, retryAt: Date | null): Promise<void> {
  if (retryAt) {
    await db.query(
      "UPDATE jobs SET status = 'en_attente', last_error = $2, run_at = $3, locked_at = NULL, updated_at = now() WHERE id = $1",
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

/** Remet en file les tâches restées "en cours" après un arrêt brutal. */
export async function requeueStale(db: Db, olderThan: Date): Promise<number> {
  const rows = await db.query<{ id: string }>(
    "UPDATE jobs SET status = 'en_attente', locked_at = NULL, updated_at = now() WHERE status = 'en_cours' AND locked_at < $1 RETURNING id",
    [olderThan],
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
