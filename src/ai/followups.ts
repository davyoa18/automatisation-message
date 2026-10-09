import { z } from "zod";
import type { Config } from "../config.js";
import type { Contact, Conversation, Lead, Message } from "../domain.js";
import type { Studio } from "../studio/knowledge.js";
import { type Llm, parseJsonLoose, textOf } from "./llm.js";
import { truncateBytes, type Clock } from "../util/index.js";
import { analyseRequest, relanceRequest, transcriptOf } from "./conversation-context.js";

/** Transcription lisible d'une conversation (pour les appels « hors conversation »). */
export function transcript(history: Message[], studio: Studio, tz = "Europe/Paris"): string {
  return transcriptOf(history, studio.vars.ASSISTANT_NAME ?? "Nova", tz);
}

/* ------------------------------ Relance ------------------------------ */

const RELANCE_SCHEMA = {
  type: "object",
  properties: {
    envoyer: { type: "boolean" },
    message: { type: "string" },
    raison: { type: "string" },
  },
  required: ["envoyer", "message", "raison"],
  additionalProperties: false,
};

const RelanceOut = z.object({ envoyer: z.boolean(), message: z.string().default(""), raison: z.string().default("") });

export async function draftRelance(
  deps: { llm: Llm; cfg: Config; studio: Studio; clock: Clock },
  args: { conversation: Conversation; contact: Contact; lead: Lead; history: Message[]; numero: number; total: number },
): Promise<z.infer<typeof RelanceOut> & { costUsd: number }> {
  const { llm, cfg, studio, clock } = deps;
  const user = relanceRequest({
    numero: args.numero,
    total: args.total,
    now: clock.now(),
    lead: args.lead,
    contact: args.contact,
    history: args.history,
    assistantName: studio.vars.ASSISTANT_NAME ?? "Nova",
    timezone: cfg.TIMEZONE,
  });
  const res = await llm.create({
    purpose: "relance",
    model: cfg.AI_MODEL_CONVERSATION,
    system: studio.prompt("relance"),
    messages: [{ role: "user", content: user }],
    outputSchema: RELANCE_SCHEMA,
    effort: "low",
    maxTokens: 2000,
    conversationId: args.conversation.id,
  });
  if (res.stopReason === "refusal") return { envoyer: false, message: "", raison: "Refus du modèle", costUsd: res.costUsd };
  const parsed = RelanceOut.parse(parseJsonLoose(textOf(res.content)));
  return { ...parsed, message: truncateBytes(parsed.message.trim(), 990), costUsd: res.costUsd };
}

/* ------------------------------ Analyse « après » ------------------------------ */

const ANALYSE_SCHEMA = {
  type: "object",
  properties: {
    resume: { type: "string" },
    temperature: { type: "string", enum: ["froid", "tiede", "chaud", "brulant"] },
    prochaine_action: { type: "string" },
    relance_manuelle: { type: "string" },
    signaux: { type: "array", items: { type: "string" } },
    risques: { type: "array", items: { type: "string" } },
  },
  required: ["resume", "temperature", "prochaine_action", "relance_manuelle", "signaux", "risques"],
  additionalProperties: false,
};

export const AnalyseOut = z.object({
  resume: z.string(),
  temperature: z.enum(["froid", "tiede", "chaud", "brulant"]),
  prochaine_action: z.string(),
  relance_manuelle: z.string().default(""),
  signaux: z.array(z.string()).default([]),
  risques: z.array(z.string()).default([]),
});
export type Analyse = z.infer<typeof AnalyseOut>;

export async function analyseConversation(
  deps: { llm: Llm; cfg: Config; studio: Studio },
  args: { conversation: Conversation; contact: Contact; lead: Lead; history: Message[] },
): Promise<Analyse & { costUsd: number }> {
  const { llm, cfg, studio } = deps;
  const user = analyseRequest({ lead: args.lead, contact: args.contact, history: args.history, assistantName: studio.vars.ASSISTANT_NAME ?? "Nova", timezone: cfg.TIMEZONE });
  const res = await llm.create({
    purpose: "analyse",
    model: cfg.AI_MODEL_ANALYSE,
    system: studio.prompt("analyse"),
    messages: [{ role: "user", content: user }],
    outputSchema: ANALYSE_SCHEMA,
    effort: "low",
    maxTokens: 3000,
    conversationId: args.conversation.id,
  });
  const parsed = AnalyseOut.parse(parseJsonLoose(textOf(res.content)));
  return { ...parsed, costUsd: res.costUsd };
}
