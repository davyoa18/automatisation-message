import { loadConfig, type Config } from "../src/config.js";
import { openDb } from "../src/db/client.js";
import { createApp, type App } from "../src/app.js";
import { ScriptedLlm, type ContentBlock, type LlmRequest } from "../src/ai/llm.js";
import { RecordingMessenger } from "../src/instagram/client.js";
import { MemoryNotifier } from "../src/notify/index.js";
import { seededRng } from "../src/util/index.js";

export class FakeClock {
  constructor(public t: Date) {}
  now(): Date {
    return new Date(this.t);
  }
  advance(ms: number): void {
    this.t = new Date(this.t.getTime() + ms);
  }
}

export interface TestApp extends App {
  llmScript: ScriptedLlm;
  ig: RecordingMessenger;
  notes: MemoryNotifier;
  fakeClock: FakeClock;
}

export async function makeApp(
  script: (req: LlmRequest, n: number) => ContentBlock[] | Promise<ContentBlock[]>,
  env: Record<string, string> = {},
  start = new Date("2026-10-12T08:00:00Z"),
): Promise<TestApp> {
  const cfg: Config = loadConfig({
    NODE_ENV: "test",
    ANTHROPIC_API_KEY: "test",
    IG_ACCOUNT_ID: "17841400000000000",
    IG_APP_SECRET: "secret",
    BOOKING_URL: "https://cal.com/yd-studio/decouverte",
    PUBLIC_BASE_URL: "https://moteur.example.fr",
    ...env,
  } as NodeJS.ProcessEnv);
  const db = await openDb({ memory: true });
  const llmScript = new ScriptedLlm(script);
  const ig = new RecordingMessenger("fake");
  const notes = new MemoryNotifier();
  const fakeClock = new FakeClock(start);
  const app = await createApp(cfg, {
    db,
    llm: llmScript,
    messenger: ig,
    notifier: notes,
    renderer: null,
    clock: fakeClock,
    rng: seededRng(42),
    wait: async () => undefined,
  });
  return Object.assign(app, { llmScript, ig, notes, fakeClock });
}

/** Le dernier message utilisateur (texte) d'une requête de conversation. */
export function lastUserText(req: LlmRequest): string {
  for (let i = req.messages.length - 1; i >= 0; i--) {
    const m = req.messages[i]!;
    if (m.role === "user" && typeof m.content === "string") return m.content;
  }
  return "";
}

/** Vrai si la requête contient des résultats d'outils (2e tour de la boucle). */
export function hasToolResults(req: LlmRequest): boolean {
  const last = req.messages[req.messages.length - 1];
  return !!last && Array.isArray(last.content) && last.content.some((b) => (b as { type: string }).type === "tool_result");
}

export function igMessageWebhook(senderId: string, mid: string, text: string, timestampMs: number, extra: Record<string, unknown> = {}) {
  return {
    object: "instagram",
    entry: [
      {
        id: "17841400000000000",
        time: timestampMs,
        messaging: [{ sender: { id: senderId }, recipient: { id: "17841400000000000" }, timestamp: timestampMs, message: { mid, text, ...extra } }],
      },
    ],
  };
}
