import type { Config } from "./config.js";
import { openDb, type Db } from "./db/client.js";
import { migrate } from "./db/migrate.js";
import { loadStudio, type Studio } from "./studio/knowledge.js";
import { AnthropicLlm, type Llm } from "./ai/llm.js";
import { GraphMessenger, RecordingMessenger, type Messenger } from "./instagram/client.js";
import { MultiNotifier, type Notifier } from "./notify/index.js";
import { PlaywrightRenderer, type Renderer } from "./ebauche/render.js";
import { Engine } from "./engine/engine.js";
import { Worker } from "./engine/worker.js";
import { Scheduler } from "./engine/scheduler.js";
import { ProspectService } from "./prospects/service.js";
import { systemClock, type Clock, type Rng } from "./util/index.js";
import { log } from "./logger.js";

export interface App {
  cfg: Config;
  db: Db;
  studio: Studio;
  llm: Llm | null;
  messenger: Messenger;
  graph: GraphMessenger | null;
  sandboxMessenger: RecordingMessenger;
  notifier: Notifier;
  renderer: Renderer | null;
  engine: Engine;
  worker: Worker;
  prospects: ProspectService;
  scheduler: Scheduler;
  clock: Clock;
  close(): Promise<void>;
}

export interface AppOverrides {
  db?: Db;
  llm?: Llm | null;
  messenger?: Messenger;
  notifier?: Notifier;
  renderer?: Renderer | null;
  clock?: Clock;
  rng?: Rng;
  wait?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
}

/** Assemble toutes les pièces du moteur à partir de la configuration. */
export async function createApp(cfg: Config, o: AppOverrides = {}): Promise<App> {
  const db = o.db ?? (await openDb({ databaseUrl: cfg.DATABASE_URL, dataDir: cfg.DATA_DIR }));
  await migrate(db);
  const studio = loadStudio(cfg);
  const clock = o.clock ?? systemClock;

  const llm = o.llm !== undefined ? o.llm : cfg.ANTHROPIC_API_KEY ? new AnthropicLlm(db, { apiKey: cfg.ANTHROPIC_API_KEY, cacheTtl: cfg.AI_CACHE_TTL, serverFallback: cfg.AI_SERVER_FALLBACK }) : null;
  if (!llm) log.warn("ANTHROPIC_API_KEY absente : l'IA ne répondra pas (les messages seront signalés à l'équipe).");

  let graph: GraphMessenger | null = null;
  let messenger: Messenger;
  if (o.messenger) messenger = o.messenger;
  else if (cfg.IG_ACCOUNT_ID && cfg.IG_ACCESS_TOKEN && !cfg.DRY_RUN) {
    graph = new GraphMessenger({ accountId: cfg.IG_ACCOUNT_ID, accessToken: cfg.IG_ACCESS_TOKEN, version: cfg.IG_GRAPH_VERSION, host: cfg.IG_API_HOST, db }, o.fetchImpl);
    messenger = graph;
  } else {
    messenger = new RecordingMessenger("dry_run");
    log.warn("Instagram non connecté (ou DRY_RUN) : aucun message ne part réellement.");
  }
  const sandboxMessenger = new RecordingMessenger("sandbox");
  const notifier = o.notifier ?? new MultiNotifier(cfg, o.fetchImpl);
  const renderer = o.renderer !== undefined ? o.renderer : cfg.EBAUCHE_ENABLED ? new PlaywrightRenderer(cfg.PLAYWRIGHT_CHROMIUM_PATH) : null;

  const engine = new Engine({ db, cfg, studio, llm, messenger, sandboxMessenger, notifier, renderer, clock, rng: o.rng, wait: o.wait });
  const prospects = new ProspectService({ db, cfg, studio, llm, clock, fetchImpl: o.fetchImpl });
  const worker = new Worker(db, async (job) => (job.type === "prospects_scan" ? void (await prospects.scan()) : engine.runJob(job)), clock);
  const scheduler = new Scheduler(db, cfg, clock, graph);

  return {
    cfg,
    db,
    studio,
    llm,
    messenger,
    graph,
    sandboxMessenger,
    notifier,
    renderer,
    engine,
    worker,
    prospects,
    scheduler,
    clock,
    async close() {
      scheduler.stop();
      await worker.stop();
      await renderer?.close();
      await db.close();
    },
  };
}
