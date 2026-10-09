import { writeFileSync } from "node:fs";
import { loadConfig } from "../src/config.js";
import { loadStudio } from "../src/studio/knowledge.js";
import { agentTools, } from "../src/ai/tools.js";
import { REPLY_SCHEMA } from "../src/ai/agent.js";

/** Écrit le prompt système rendu + les outils, pour relecture humaine ou évaluation. */
const cfg = loadConfig({ BOOKING_URL: process.env.BOOKING_URL ?? "https://cal.com/yd-studio/decouverte" } as NodeJS.ProcessEnv);
const studio = loadStudio(cfg);
const out = process.argv[2] ?? "evals/prompt-conversation.md";
const tools = agentTools(studio).map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
writeFileSync(
  out,
  `${studio.prompt("conversation")}\n\n---\n\n# Outils disponibles (définitions JSON)\n\n\`\`\`json\n${JSON.stringify(tools, null, 2)}\n\`\`\`\n\n# Schéma de la réponse finale\n\n\`\`\`json\n${JSON.stringify(REPLY_SCHEMA, null, 2)}\n\`\`\`\n`,
);
console.log(`Prompt écrit dans ${out}`);
