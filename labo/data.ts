/**
 * Données figées dans la page du Labo au moment du build (côté Node) : les prompts de production
 * rendus avec la base de connaissances, les définitions d'outils et les réglages du moteur.
 */
import { execFileSync } from "node:child_process";
import type { Config } from "../src/config.js";
import type { Studio } from "../src/studio/knowledge.js";
import { agentTools } from "../src/ai/tools.js";
import type { LaboData } from "./runtime.js";

function gitCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "local";
  }
}

export function buildLaboData(cfg: Config, studio: Studio, now = new Date()): LaboData {
  return {
    builtAt: now.toISOString(),
    commit: gitCommit(),
    vars: { ...studio.vars },
    budgetMin: studio.facts.budget_minimum_eur,
    timezone: cfg.TIMEZONE,
    bookingUrl: cfg.BOOKING_URL ?? "",
    prompts: {
      conversation: studio.prompt("conversation"),
      relance: studio.prompt("relance"),
      analyse: studio.prompt("analyse"),
    },
    tools: agentTools(studio).map((t) => ({
      name: t.name,
      description: t.description ?? "",
      input_schema: t.input_schema as unknown as Record<string, unknown>,
    })),
    relanceDelaysMs: cfg.relanceDelaysMs,
    pacing: { profile: cfg.PACING_PROFILE, debounceSeconds: cfg.REPLY_DEBOUNCE_SECONDS },
    aiPauseHours: cfg.HUMAN_TAKEOVER_PAUSE_HOURS,
    models: { conversation: cfg.AI_MODEL_CONVERSATION, analyse: cfg.AI_MODEL_ANALYSE, ebauche: cfg.AI_MODEL_EBAUCHE },
  };
}
