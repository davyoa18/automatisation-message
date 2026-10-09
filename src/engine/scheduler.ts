import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { getSetting, setSetting } from "../db/repo/misc.js";
import { enqueue } from "../db/repo/jobs.js";
import type { GraphMessenger } from "../instagram/client.js";
import { log } from "../logger.js";
import { errorMessage, type Clock } from "../util/index.js";

function parisParts(d: Date, tz: string): { date: string; hhmm: string; weekday: string } {
  const f = new Intl.DateTimeFormat("fr-FR", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "long", hourCycle: "h23" }).formatToParts(d);
  const g = (t: string) => f.find((p) => p.type === t)?.value ?? "";
  return { date: `${g("year")}-${g("month")}-${g("day")}`, hhmm: `${g("hour")}:${g("minute")}`, weekday: g("weekday") };
}

/** Tâches périodiques : scan des prospects, bilan hebdomadaire, renouvellement du jeton Instagram. */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private db: Db,
    private cfg: Config,
    private clock: Clock,
    private graph: GraphMessenger | null,
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), 60_000);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    const now = this.clock.now();
    const p = parisParts(now, this.cfg.TIMEZONE);
    try {
      if (p.hhmm >= this.cfg.PROSPECTS_SCAN_AT && (await getSetting<string>(this.db, "last_prospects_scan")) !== p.date) {
        await setSetting(this.db, "last_prospects_scan", p.date);
        await enqueue(this.db, "prospects_scan", {}, { runAt: now, dedupeKey: `prospects_scan:${p.date}` });
      }
      if (p.weekday === "lundi" && p.hhmm >= "08:45" && (await getSetting<string>(this.db, "last_digest")) !== p.date) {
        await setSetting(this.db, "last_digest", p.date);
        await enqueue(this.db, "notifier", { kind: "bilan", digest: true }, { runAt: now, dedupeKey: `digest:${p.date}` });
      }
      if (this.graph) {
        const last = await getSetting<{ refreshed_at?: string }>(this.db, "ig_token");
        const lastAt = last?.refreshed_at ? Date.parse(last.refreshed_at) : 0;
        if (now.getTime() - lastAt > 7 * 86_400_000) {
          try {
            await this.graph.refreshToken();
            log.info("jeton Instagram renouvelé");
          } catch (err) {
            // Échec silencieux tant que le jeton actuel marche ; on réessaie au prochain passage.
            log.warn("renouvellement du jeton Instagram impossible", { error: errorMessage(err) });
            await setSetting(this.db, "ig_token", { ...(last ?? {}), refreshed_at: new Date(now.getTime() - 6 * 86_400_000).toISOString() });
          }
        }
      }
    } catch (err) {
      log.error("planificateur", { error: err });
    }
  }
}
