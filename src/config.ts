import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0", "yes", "no", "oui", "non"])
  .transform((v) => ["true", "1", "yes", "oui"].includes(v));

const list = z.string().transform((v) =>
  v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

/**
 * Toute la configuration vient des variables d'environnement (voir .env.example).
 * Les secrets ne sont jamais écrits dans le code ni dans la base.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000"),
  TIMEZONE: z.string().default("Europe/Paris"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  DATABASE_URL: z.string().optional(),
  DATA_DIR: z.string().default("./data"),

  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL_CONVERSATION: z.string().default("claude-sonnet-5-5"),
  AI_MODEL_EBAUCHE: z.string().default("claude-opus-5-5"),
  AI_MODEL_ANALYSE: z.string().default("claude-haiku-5-5"),
  AI_MODEL_PROSPECTION: z.string().default("claude-haiku-5-5"),
  AI_EFFORT_CONVERSATION: z.enum(["low", "medium", "high"]).default("low"),
  AI_CACHE_TTL: z.enum(["5m", "1h"]).default("1h"),
  AI_SERVER_FALLBACK: bool.default(true),
  AI_MONTHLY_BUDGET_USD: z.coerce.number().nonnegative().default(150),
  DRY_RUN: bool.default(false),

  IG_ACCOUNT_ID: z.string().optional(),
  IG_ACCESS_TOKEN: z.string().optional(),
  IG_APP_SECRET: z.string().optional(),
  IG_VERIFY_TOKEN: z.string().optional(),
  IG_GRAPH_VERSION: z.string().default("v26.0"),
  IG_API_HOST: z.string().default("graph.instagram.com"),
  IG_TYPING_INDICATOR: bool.default(true),
  IG_HUMAN_AGENT_TAG: bool.default(false),

  STUDIO_NAME: z.string().default("YD Studio"),
  ASSISTANT_NAME: z.string().default("Nova"),
  BOOKING_URL: z.string().optional(),

  PACING_PROFILE: z.enum(["naturel", "rapide", "instantane"]).default("naturel"),
  REPLY_DEBOUNCE_SECONDS: z.coerce.number().nonnegative().default(8),
  RELANCES: list.prefault("3h,21h"),
  HUMAN_TAKEOVER_PAUSE_HOURS: z.coerce.number().positive().default(12),
  MAX_AI_TURNS_PER_CONVERSATION: z.coerce.number().int().positive().default(40),

  COCKPIT_PASSWORD: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
  MCP_TOKEN: z.string().optional(),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  NOTIFY_EMAIL_TO: z.string().optional(),
  NOTIFY_EMAIL_FROM: z.string().optional(),
  NOTIFY_WEBHOOK_URL: z.string().optional(),

  EBAUCHE_ENABLED: bool.default(true),
  EBAUCHE_TEASER: z.enum(["aucun", "flou", "complet"]).default("aucun"),
  PLAYWRIGHT_CHROMIUM_PATH: z.string().optional(),

  PROSPECTS_SCAN_AT: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .default("07:30"),
  PROSPECTS_RSS: list.prefault(""),
});

export type Config = z.infer<typeof EnvSchema> & {
  relanceDelaysMs: number[];
};

function parseDuration(spec: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(m|min|h|j|d)$/.exec(spec.trim().toLowerCase());
  if (!m) throw new Error(`Durée de relance invalide : "${spec}" (attendu : 45m, 3h, 1j…)`);
  const n = Number(m[1]);
  const unit = m[2];
  if (unit === "m" || unit === "min") return n * 60_000;
  if (unit === "h") return n * 3_600_000;
  return n * 86_400_000;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Une variable vide dans .env vaut "non renseignée".
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ""));
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")} : ${i.message}`);
    throw new Error(`Configuration invalide :\n${lines.join("\n")}`);
  }
  const cfg = parsed.data;
  return { ...cfg, relanceDelaysMs: cfg.RELANCES.map(parseDuration) };
}

/** Ce qui manque pour passer en production, en clair. */
export function productionGaps(cfg: Config): string[] {
  const gaps: string[] = [];
  if (!cfg.ANTHROPIC_API_KEY) gaps.push("ANTHROPIC_API_KEY (clé API Claude)");
  if (!cfg.DATABASE_URL) gaps.push("DATABASE_URL (Postgres ; sinon base locale PGlite dans DATA_DIR)");
  if (!cfg.IG_ACCOUNT_ID || !cfg.IG_ACCESS_TOKEN) gaps.push("IG_ACCOUNT_ID + IG_ACCESS_TOKEN (compte Instagram pro)");
  if (!cfg.IG_APP_SECRET) gaps.push("IG_APP_SECRET (vérification des webhooks)");
  if (!cfg.IG_VERIFY_TOKEN) gaps.push("IG_VERIFY_TOKEN (validation de l'URL de webhook)");
  if (!cfg.COCKPIT_PASSWORD) gaps.push("COCKPIT_PASSWORD (accès au cockpit)");
  if (!cfg.SESSION_SECRET || cfg.SESSION_SECRET.length < 32) gaps.push("SESSION_SECRET (32 caractères minimum)");
  if (!cfg.BOOKING_URL) gaps.push("BOOKING_URL (lien de prise de rendez-vous de 10 min)");
  return gaps;
}
