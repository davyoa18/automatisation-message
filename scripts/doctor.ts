/**
 * Auto-diagnostic : vérifie, avec les vraies clés, que chaque brique répond comme prévu.
 * À lancer après avoir rempli .env, et après chaque changement de configuration.
 *
 *   npm run doctor               (tout)
 *   npm run doctor -- --notif    (envoie aussi une notification de test à l'équipe)
 */
import { existsSync } from "node:fs";
import { loadConfig, productionGaps } from "../src/config.js";
import { openDb } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { AnthropicLlm, parseJsonLoose, textOf } from "../src/ai/llm.js";
import { REPLY_SCHEMA } from "../src/ai/agent.js";
import { GraphMessenger } from "../src/instagram/client.js";
import { MultiNotifier } from "../src/notify/index.js";
import { PlaywrightRenderer } from "../src/ebauche/render.js";
import type { EbaucheBrief } from "../src/domain.js";

if (existsSync(".env")) process.loadEnvFile(".env");
const cfg = loadConfig();
let failures = 0;
const ok = (label: string, detail = "") => console.log(`✓ ${label}${detail ? ` — ${detail}` : ""}`);
const ko = (label: string, detail: string) => {
  failures++;
  console.log(`✗ ${label} — ${detail}`);
};
const run = async (label: string, fn: () => Promise<string | void>) => {
  try {
    ok(label, (await fn()) ?? "");
  } catch (err) {
    ko(label, (err as Error).message);
  }
};

console.log("Diagnostic du moteur DM\n");
const gaps = productionGaps(cfg);
if (gaps.length) console.log(`! Configuration incomplète : ${gaps.join(" · ")}\n`);

const db = await openDb({ databaseUrl: cfg.DATABASE_URL, dataDir: cfg.DATA_DIR });
await run("Base de données", async () => {
  await migrate(db);
  await db.query("SELECT 1");
  return db.kind === "pg" ? "Postgres" : "PGlite locale";
});

if (cfg.ANTHROPIC_API_KEY) {
  const llm = new AnthropicLlm(db, { apiKey: cfg.ANTHROPIC_API_KEY, cacheTtl: cfg.AI_CACHE_TTL, serverFallback: cfg.AI_SERVER_FALLBACK });
  await run(`IA conversation (${cfg.AI_MODEL_CONVERSATION}) : outils + sortie structurée + contexte système`, async () => {
    const res = await llm.create({
      purpose: "diagnostic",
      model: cfg.AI_MODEL_CONVERSATION,
      system: "Tu es un test de diagnostic. Réponds en JSON selon le schéma, sans appeler d'outil.",
      messages: [
        { role: "user", content: "Dis bonjour en une phrase." },
        { role: "system", content: "Contexte de test : aucun." } as never,
      ],
      tools: [{ name: "noop", description: "Ne pas utiliser.", strict: true, input_schema: { type: "object", properties: {}, required: [], additionalProperties: false } }],
      outputSchema: REPLY_SCHEMA as unknown as Record<string, unknown>,
      effort: cfg.AI_EFFORT_CONVERSATION,
      maxTokens: 2000,
    });
    const parsed = parseJsonLoose(textOf(res.content)) as { messages?: string[] };
    if (!Array.isArray(parsed.messages)) throw new Error("réponse JSON inattendue");
    return `« ${parsed.messages[0] ?? ""} » (${res.costUsd.toFixed(4)} $, servi par ${res.model})`;
  });
  for (const [label, model] of [
    ["IA analyses", cfg.AI_MODEL_ANALYSE],
    ["IA ébauches", cfg.AI_MODEL_EBAUCHE],
  ] as const) {
    await run(`${label} (${model})`, async () => {
      const res = await llm.create({ purpose: "diagnostic", model, system: "Test.", messages: [{ role: "user", content: "Réponds juste OK." }], effort: "low", maxTokens: 500 });
      return `« ${textOf(res.content).trim().slice(0, 40)} »`;
    });
  }
} else {
  ko("IA", "ANTHROPIC_API_KEY absente");
}

if (cfg.IG_ACCOUNT_ID && cfg.IG_ACCESS_TOKEN) {
  const ig = new GraphMessenger({ accountId: cfg.IG_ACCOUNT_ID, accessToken: cfg.IG_ACCESS_TOKEN, version: cfg.IG_GRAPH_VERSION, host: cfg.IG_API_HOST, db });
  await run("Instagram : jeton et compte", async () => {
    const me = await ig.me();
    return `@${String(me.username ?? "?")} (${String(me.account_type ?? "type inconnu")}, ${String(me.followers_count ?? "?")} abonnés)`;
  });
} else {
  ko("Instagram", "IG_ACCOUNT_ID / IG_ACCESS_TOKEN absents");
}

await run("URL publique et webhook", async () => {
  const res = await fetch(`${cfg.PUBLIC_BASE_URL}/health`);
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${cfg.PUBLIC_BASE_URL}/health`);
  const verify = await fetch(`${cfg.PUBLIC_BASE_URL}/webhooks/instagram?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(cfg.IG_VERIFY_TOKEN ?? "")}&hub.challenge=diag`);
  if ((await verify.text()) !== "diag") throw new Error("la vérification du webhook échoue (IG_VERIFY_TOKEN ?)");
  return `${cfg.PUBLIC_BASE_URL}/webhooks/instagram répond`;
});

if (cfg.EBAUCHE_ENABLED) {
  await run("Rendu des maquettes (Chromium)", async () => {
    const r = new PlaywrightRenderer(cfg.PLAYWRIGHT_CHROMIUM_PATH);
    const brief = { nom_app: "Test", promesse: "Diagnostic", direction_artistique: { couleurs: ["#eeeeee"] } } as unknown as EbaucheBrief;
    const out = await r.render([{ titre: "Test", html: "<div style='padding:80px 24px;font:20px sans-serif'>OK</div>" }], brief, cfg.STUDIO_NAME);
    await r.close();
    return `${Math.round(out.board.length / 1024)} Ko`;
  });
}

const notifier = new MultiNotifier(cfg);
const channels = notifier.channels();
if (!channels.length) ko("Notifications", "aucun canal (Telegram, email ou webhook)");
else if (process.argv.includes("--notif")) {
  await run(`Notification de test (${channels.join(", ")})`, async () => {
    const r = await notifier.send({ kind: "test", title: "Test du moteur DM", body: "Si tu lis ceci, les alertes fonctionnent." });
    if (r.failed.length) throw new Error(`échec : ${r.failed.join(", ")}`);
    return r.delivered.join(", ");
  });
} else ok("Notifications configurées", `${channels.join(", ")} (ajoute --notif pour envoyer un test)`);

await db.close();
console.log(failures ? `\n${failures} point(s) à corriger.` : "\nTout est prêt.");
process.exit(failures ? 1 : 0);
