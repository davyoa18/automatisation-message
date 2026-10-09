import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import type { Contact, Conversation, Ebauche, Lead, Message } from "../domain.js";
import type { Studio } from "../studio/knowledge.js";
import { type Llm, type MessageParam, parseJsonLoose, textOf } from "./llm.js";
import { agentTools, resolveToolName, runTool, type AgentAction, type ToolRuntime } from "./tools.js";
import { supportsMidConversationSystem } from "./models.js";
import { buildContext, ensureDisclosure, FALLBACK_REPLY, historyToTurns, REPLY_SCHEMA, sanitizeButtons, sanitizeMessages } from "./conversation-context.js";
import type { Clock } from "../util/index.js";
import { log } from "../logger.js";

export { buildContext, historyToTurns, REPLY_SCHEMA, sanitizeButtons, sanitizeMessages } from "./conversation-context.js";

const ReplySchema = z.object({
  messages: z.array(z.string()).default([]),
  boutons: z.array(z.string()).default([]),
  relance_utile: z.boolean().default(false),
  note_equipe: z.string().default(""),
});

export interface AgentInput {
  conversation: Conversation;
  contact: Contact;
  lead: Lead;
  history: Message[];
  ebauche: Ebauche | null;
}

export interface AgentOutput {
  messages: string[];
  boutons: string[];
  relanceUtile: boolean;
  noteEquipe: string;
  actions: AgentAction[];
  refused: boolean;
  lead: Lead;
  contact: Contact;
  costUsd: number;
  model: string;
}

export interface AgentDeps {
  db: Db;
  cfg: Config;
  llm: Llm;
  studio: Studio;
  clock: Clock;
}

const MAX_ROUNDS = 5;

export async function runAgent(input: AgentInput, deps: AgentDeps): Promise<AgentOutput> {
  const { cfg, studio, llm } = deps;
  const model = cfg.AI_MODEL_CONVERSATION;
  const tools = agentTools(studio);
  // Seul ce que le prospect a reçu compte : une bulle en échec ou annulée ne l'a pas présentée.
  const delivered = input.history.filter((m) => (m.direction === "entrant" ? m.status !== "annule" : m.status === "envoye"));
  const isFirstAiMessage = !delivered.some((m) => m.direction === "sortant" && m.author === "ia");
  const rt: ToolRuntime = {
    db: deps.db,
    cfg,
    studio,
    clock: deps.clock,
    conversation: input.conversation,
    contact: input.contact,
    lead: input.lead,
    actions: [],
    isSandbox: input.conversation.channel === "bac_a_sable",
  };

  const system = studio.prompt("conversation");
  const turns = historyToTurns(delivered, input.conversation);
  if (!turns.length || turns[turns.length - 1]!.role !== "user") {
    turns.push({ role: "user", content: "[Aucun nouveau message : relis la conversation et réponds seulement si c'est utile.]" });
  }
  const context = buildContext(input, { now: deps.clock.now(), timezone: cfg.TIMEZONE, bookingUrl: cfg.BOOKING_URL ?? "" }, isFirstAiMessage);
  const messages: MessageParam[] = [...turns];
  if (supportsMidConversationSystem(model)) {
    messages.push({ role: "system", content: context } as unknown as MessageParam);
  } else {
    const last = messages[messages.length - 1]!;
    const lastText = typeof last.content === "string" ? last.content : "";
    messages[messages.length - 1] = { role: "user", content: `${lastText}\n\n[Note interne, invisible pour le prospect]\n${context}` };
  }

  let cost = 0;
  let servedModel = model;
  let final: z.infer<typeof ReplySchema> | null = null;
  let refused = false;
  let repaired = false;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await llm.create({
      purpose: "conversation",
      model,
      system,
      messages,
      tools,
      outputSchema: REPLY_SCHEMA as unknown as Record<string, unknown>,
      effort: cfg.AI_EFFORT_CONVERSATION,
      maxTokens: 6000,
      conversationId: input.conversation.id,
    });
    cost += res.costUsd;
    servedModel = res.model;
    if (res.stopReason === "refusal") {
      refused = true;
      break;
    }
    const toolUses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (toolUses.length) {
      messages.push({ role: "assistant", content: res.content as MessageParam["content"] });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const name = resolveToolName(tu.name, tools);
        let out: Record<string, unknown>;
        try {
          out = await runTool(rt, name, tu.input);
        } catch (err) {
          log.error("outil en échec", { tool: name, error: err });
          out = { erreur: "L'action n'a pas pu être enregistrée. Continue la conversation sans la mentionner." };
        }
        results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out) });
      }
      messages.push({ role: "user", content: results });
      continue;
    }
    const text = textOf(res.content);
    try {
      final = ReplySchema.parse(parseJsonLoose(text));
      break;
    } catch (err) {
      if (repaired) {
        log.warn("réponse finale illisible", { text: text.slice(0, 300) });
        break;
      }
      repaired = true;
      messages.push({ role: "assistant", content: res.content as MessageParam["content"] });
      messages.push({ role: "user", content: "[Format] Réponds uniquement avec l'objet JSON demandé (messages, boutons, relance_utile, note_equipe)." });
    }
  }

  if (refused || !final) {
    // Filet de sécurité : on ne laisse jamais la personne sans réponse, on passe la main.
    await runTool(rt, "passer_la_main", {
      raison: refused ? "Le modèle a refusé de répondre à ce message." : "Réponse de l'IA inexploitable.",
      urgence: "haute",
    });
    return {
      messages: [FALLBACK_REPLY],
      boutons: [],
      relanceUtile: false,
      noteEquipe: refused ? "Refus du modèle : à traiter à la main." : "Réponse IA illisible : à traiter à la main.",
      actions: rt.actions,
      refused,
      lead: rt.lead,
      contact: rt.contact,
      costUsd: cost,
      model: servedModel,
    };
  }

  const out = ensureDisclosure(sanitizeMessages(final.messages), isFirstAiMessage, studio.vars);
  return {
    messages: out,
    boutons: sanitizeButtons(final.boutons),
    relanceUtile: final.relance_utile,
    noteEquipe: final.note_equipe.trim(),
    actions: rt.actions,
    refused: false,
    lead: rt.lead,
    contact: rt.contact,
    costUsd: cost,
    model: servedModel,
  };
}
