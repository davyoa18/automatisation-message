/**
 * Serveur MCP en local (stdio) : à déclarer dans Claude Code ou Claude Desktop pour piloter le
 * moteur depuis une conversation avec Claude. Il se connecte à la même base que le moteur.
 *
 *   claude mcp add moteur-dm -- npx tsx src/mcp/server.ts
 */
import { existsSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { logToStderrOnly } from "../logger.js";

logToStderrOnly();
if (existsSync(".env")) process.loadEnvFile(".env");

const { loadConfig } = await import("../config.js");
const { createApp } = await import("../app.js");
const { createMcpServer } = await import("./tools.js");

const cfg = loadConfig();
// Le serveur MCP ne fait pas tourner la file de tâches (le moteur en production s'en charge) ;
// il ne génère pas d'ébauches lui-même.
const app = await createApp({ ...cfg, EBAUCHE_ENABLED: cfg.EBAUCHE_ENABLED }, { renderer: null });
const server = createMcpServer(app, { workerRunning: false });
await server.connect(new StdioServerTransport());

const stop = async () => {
  await app.close();
  process.exit(0);
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
