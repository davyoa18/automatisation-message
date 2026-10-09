import type { Db } from "../db/client.js";
import type { Job } from "../domain.js";
import { claimNext, completeJob, failJob, heartbeatJobs, releaseJobs, requeueStale } from "../db/repo/jobs.js";
import { logEvent } from "../db/repo/misc.js";
import { addMs, errorMessage, sleep, type Clock } from "../util/index.js";
import { log } from "../logger.js";

export type JobHandler = (job: Job) => Promise<void>;

const BACKOFF_MS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000];
export const MAX_ATTEMPTS = 5;
/** Signe de vie des tâches en cours, et délai au-delà duquel une tâche sans signe de vie est reprise. */
const HEARTBEAT_MS = 30_000;
const STALE_AFTER_MS = 3 * 60_000;

/**
 * Exécute les tâches de la file (en base) : plusieurs en parallèle, avec reprise après
 * plantage et nouvelles tentatives espacées.
 */
export class Worker {
  private running = false;
  private active = 0;
  private loop: Promise<void> | null = null;
  private lastStaleCheck = 0;
  private owned = new Set<string>();
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(
    private db: Db,
    private handler: JobHandler,
    private clock: Clock,
    private opts: { concurrency?: number; pollMs?: number } = {},
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = this.run();
    this.heartbeat = setInterval(() => {
      void heartbeatJobs(this.db, [...this.owned], this.clock.now()).catch((err) => log.warn("signe de vie des tâches", { error: errorMessage(err) }));
    }, HEARTBEAT_MS);
  }

  /**
   * Arrêt propre : plus de nouvelle tâche, on laisse finir celles en cours quelques secondes,
   * puis on rend les autres à la file (elles reprendront au redémarrage, sans attendre).
   */
  async stop(graceMs = 8_000): Promise<void> {
    this.running = false;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    await this.loop;
    const deadline = Date.now() + graceMs;
    while (this.active > 0 && Date.now() < deadline) await sleep(50);
    if (this.owned.size) {
      const n = await releaseJobs(this.db, [...this.owned]).catch(() => 0);
      if (n) log.info("tâches rendues à la file avant l'arrêt", { n });
    }
  }

  private async run(): Promise<void> {
    const concurrency = this.opts.concurrency ?? 6;
    const pollMs = this.opts.pollMs ?? 1000;
    while (this.running) {
      try {
        const now = this.clock.now();
        if (now.getTime() - this.lastStaleCheck > 60_000) {
          this.lastStaleCheck = now.getTime();
          const n = await requeueStale(this.db, addMs(now, -STALE_AFTER_MS));
          if (n) log.warn("tâches bloquées remises en file", { n });
        }
        let claimed = false;
        while (this.running && this.active < concurrency) {
          const job = await claimNext(this.db, this.clock.now());
          if (!job) break;
          claimed = true;
          this.active++;
          void this.execute(job).finally(() => {
            this.active--;
          });
        }
        if (!claimed) await sleep(pollMs);
      } catch (err) {
        log.error("boucle de tâches", { error: err });
        await sleep(pollMs * 3);
      }
    }
  }

  async execute(job: Job): Promise<void> {
    const started = Date.now();
    this.owned.add(job.id);
    try {
      await this.handler(job);
      await completeJob(this.db, job.id);
      log.debug("tâche terminée", { type: job.type, ms: Date.now() - started });
    } catch (err) {
      const msg = errorMessage(err);
      const retry = job.attempts < MAX_ATTEMPTS ? addMs(this.clock.now(), BACKOFF_MS[Math.min(job.attempts - 1, BACKOFF_MS.length - 1)] ?? 60_000) : null;
      await failJob(this.db, job.id, msg, retry);
      log.warn("tâche en échec", { type: job.type, attempts: job.attempts, retry: !!retry, error: msg });
      if (!retry) await logEvent(this.db, "tache_abandonnee", { type: job.type, error: msg, payload: job.payload });
    } finally {
      this.owned.delete(job.id);
    }
  }

  /** Exécute séquentiellement toutes les tâches dues (tests, scripts). */
  async drain(maxJobs = 200): Promise<number> {
    let n = 0;
    while (n < maxJobs) {
      const job = await claimNext(this.db, this.clock.now());
      if (!job) break;
      await this.execute(job);
      n++;
    }
    return n;
  }
}
