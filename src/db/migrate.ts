import type { Db } from "./client.js";
import { MIGRATIONS } from "./migrations.js";
import { log } from "../logger.js";

export async function migrate(db: Db): Promise<string[]> {
  await db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const done = new Set((await db.query<{ id: string }>("SELECT id FROM schema_migrations")).map((r) => r.id));
  const applied: string[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    await db.tx(async (t) => {
      await t.exec(m.sql);
      await t.query("INSERT INTO schema_migrations (id) VALUES ($1)", [m.id]);
    });
    applied.push(m.id);
    log.info("migration appliquée", { id: m.id });
  }
  return applied;
}
