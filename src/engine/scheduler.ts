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

/** Dépense d'IA depuis une date (table llm_usage). */
async function aiSpendSince(db: Db, since: Date): Promise<number> {
  const row = await db.one<{ c: number }>("SELECT coalesce(sum(cost_usd), 0)::float AS c FROM llm_usage WHERE created_at >= $1", [since]);
  return Number(row?.c ?? 0);
}

/** Tâches périodiques : scan des prospects, bilan hebdomadaire, alerte de budget IA, renouvellement du jeton Instagram. */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private lastBudgetCheck = 0;

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
      await this.checkAiBudget(now, p.date.slice(0, 7));
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

  /** Une alerte par mois quand la dépense d'IA dépasse AI_MONTHLY_BUDGET_USD (le moteur continue de répondre). */
  private async checkAiBudget(now: Date, month: string): Promise<void> {
    const budget = this.cfg.AI_MONTHLY_BUDGET_USD;
    if (!budget || now.getTime() - this.lastBudgetCheck < 10 * 60_000) return;
    this.lastBudgetCheck = now.getTime();
    if ((await getSetting<string>(this.db, "budget_ia_alerte")) === month) return;
    const spent = await aiSpendSince(this.db, new Date(`${month}-01T00:00:00Z`));
    if (spent < budget) return;
    await setSetting(this.db, "budget_ia_alerte", month);
    await enqueue(
      this.db,
      "notifier",
      {
        kind: "budget_ia",
        title: `Budget IA dépassé : ${spent.toFixed(2)} $ ce mois-ci`,
        body: `Le plafond mensuel est de ${budget} $ (AI_MONTHLY_BUDGET_USD). Le moteur continue de répondre : vérifiez les coûts dans le cockpit, ou relevez le plafond.`,
        urgent: true,
      },
      { runAt: now, dedupeKey: `budget_ia:${month}` },
    );
    log.warn("budget IA mensuel dépassé", { spent, budget });
  }
}
