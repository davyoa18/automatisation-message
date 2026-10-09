import { serve } from "@hono/node-server";
import { existsSync } from "node:fs";
import { loadConfig, productionGaps } from "./config.js";
import { createApp } from "./app.js";
import { createServer } from "./web/server.js";
import { log, setLogLevel } from "./logger.js";
import { listCommentRules, upsertCommentRule } from "./db/repo/misc.js";

if (existsSync(".env")) process.loadEnvFile(".env");
const cfg = loadConfig();
setLogLevel(cfg.LOG_LEVEL);

const app = await createApp(cfg);

// Première installation : une règle « commentaire → DM » prête à l'emploi.
if (!(await listCommentRules(app.db, false)).length) {
  await upsertCommentRule(app.db, { keywords: ["APP", "MAQUETTE", "DEVIS"] });
}

app.worker.start();
app.scheduler.start();
const web = createServer(app, { workerRunning: true });
const server = serve({ fetch: web.fetch, port: cfg.PORT }, (info) => {
  log.info("moteur DM démarré", {
    port: info.port,
    url: cfg.PUBLIC_BASE_URL,
    instagram: app.messenger.mode,
    ia: !!app.llm,
    db: app.db.kind,
  });
  const gaps = productionGaps(cfg);
  if (gaps.length) log.warn("configuration incomplète", { manque: gaps });
});

async function shutdown(signal: string) {
  log.info("arrêt demandé", { signal });
  server.close();
  await app.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
