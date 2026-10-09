import { z } from "zod";
import type { Config } from "../config.js";
import type { Contact, Conversation, Lead, Message } from "../domain.js";
import type { Studio } from "../studio/knowledge.js";
import { type Llm, parseJsonLoose, textOf } from "./llm.js";
import { formatParis, truncateBytes, type Clock } from "../util/index.js";

/** Transcription lisible d'une conversation (pour les appels « hors conversation »). */
export function transcript(history: Message[], studio: Studio, tz = "Europe/Paris"): string {
  return history
    .filter((m) => m.status !== "annule" && (m.text ?? "").trim())
    .map((m) => {
      const who =
        m.direction === "entrant" ? "Prospect" : m.author === "humain" ? "Équipe" : m.author === "ia" ? studio.vars.ASSISTANT_NAME : "Système";
      const when = formatParis(new Date(m.created_at), tz);
      return `[${when}] ${who} : ${(m.text ?? "").trim()}`;
    })
    .join("\n");
}

function leadBlock(lead: Lead, contact: Contact): string {
  return [
    `Étape : ${lead.stage} · Budget : ${lead.budget_status} · Score : ${lead.score}/100`,
    `Profil : ${contact.username ? "@" + contact.username : "?"}${contact.name ? " · " + contact.name : ""}`,
    `Fiche : ${JSON.stringify(lead.fiche)}`,
    lead.summary ? `Résumé : ${lead.summary}` : "",
  ]
    .filter(Boolean)
    .join("\n");
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
  const user = [
    `Relance n°${args.numero} sur ${args.total}${args.numero === args.total ? " (la dernière)" : ""}.`,
    `Maintenant : ${formatParis(clock.now(), cfg.TIMEZONE)}.`,
    "",
    "## Fiche",
    leadBlock(args.lead, args.contact),
    "",
    "## Conversation",
    transcript(args.history, studio, cfg.TIMEZONE),
  ].join("\n");
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
  const user = ["## Fiche", leadBlock(args.lead, args.contact), "", "## Conversation", transcript(args.history, studio, cfg.TIMEZONE)].join("\n");
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
