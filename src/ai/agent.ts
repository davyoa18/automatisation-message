import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import type { Contact, Conversation, Ebauche, Lead, Message } from "../domain.js";
import { STAGE_LABELS } from "../domain.js";
import type { Studio } from "../studio/knowledge.js";
import { type Llm, type MessageParam, parseJsonLoose, textOf } from "./llm.js";
import { agentTools, resolveToolName, runTool, type AgentAction, type ToolRuntime } from "./tools.js";
import { supportsMidConversationSystem } from "./models.js";
import { formatParis, truncateBytes, type Clock } from "../util/index.js";
import { log } from "../logger.js";

export const REPLY_SCHEMA = {
  type: "object",
  properties: {
    messages: { type: "array", items: { type: "string" }, description: "Bulles à envoyer, dans l'ordre (0 à 3)" },
    boutons: { type: "array", items: { type: "string" }, description: "0 à 3 réponses rapides de 20 caractères maximum" },
    relance_utile: { type: "boolean" },
    note_equipe: { type: "string" },
  },
  required: ["messages", "boutons", "relance_utile", "note_equipe"],
  additionalProperties: false,
} as const;

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

const SOURCE_LABELS: Record<string, string> = {
  dm: "message privé direct",
  commentaire: "commentaire sous un post (message privé envoyé en réponse)",
  story: "réponse à une story",
  mention: "mention dans une story",
  pub: "publicité Instagram « Envoyer un message »",
  sortant: "réponse à un premier message envoyé par l'équipe",
  ice_breaker: "question d'accueil Instagram",
  bac_a_sable: "test interne dans le cockpit (bac à sable)",
};

const MAX_ROUNDS = 5;

/** Transforme l'historique stocké en tours user/assistant lisibles par le modèle. */
export function historyToTurns(history: Message[], conversation: Conversation): MessageParam[] {
  const turns: { role: "user" | "assistant"; text: string }[] = [];
  for (const m of history) {
    let text = (m.text ?? "").trim();
    const p = m.payload ?? {};
    if (m.direction === "entrant") {
      if (m.kind === "story_reply") text = `[Réponse à ta story${p.storyUrl ? "" : ""}] ${text}`.trim();
      else if (m.kind === "story_mention") text = `[Cette personne t'a mentionné dans sa story] ${text}`.trim();
      else if (m.kind === "postback") text = `[A touché le bouton « ${String(p.title ?? text)} »]`;
      else if (m.kind === "commentaire") text = `[Commentaire public sous un post du studio : « ${text} »]`;
      else if (m.kind === "image" || m.kind === "pieces") text = `[Pièce jointe : ${String(p.attachmentType ?? "fichier")}] ${text}`.trim();
      if (p.adTitle) text = `[Arrivé via la publicité « ${String(p.adTitle)} »] ${text}`;
      if (!text) continue;
      turns.push({ role: "user", text });
    } else {
      if (!text) continue;
      if (m.author === "humain") text = `[Équipe] ${text}`;
      turns.push({ role: "assistant", text });
    }
  }
  // Fusion des tours consécutifs du même rôle.
  const merged: { role: "user" | "assistant"; text: string }[] = [];
  for (const t of turns) {
    const last = merged[merged.length - 1];
    if (last && last.role === t.role) last.text += `\n${t.text}`;
    else merged.push({ ...t });
  }
  if (merged[0]?.role === "assistant") {
    merged.unshift({ role: "user", text: `[Début de la conversation : ${SOURCE_LABELS[conversation.source] ?? conversation.source}]` });
  }
  return merged.map((t) => ({ role: t.role, content: t.text }));
}

function describeEbauche(e: Ebauche | null): string {
  if (!e) return "aucune";
  if (e.status === "prete") return "prête (l'équipe la montrera pendant l'appel)";
  if (e.status === "echec") return "échec de génération (l'équipe la prépare à la main)";
  return "en préparation";
}

export function buildContext(input: AgentInput, deps: Pick<AgentDeps, "cfg" | "studio" | "clock">, isFirstAiMessage: boolean): string {
  const { contact, lead, conversation, ebauche } = input;
  const now = deps.clock.now();
  const profil = [
    contact.username ? `@${contact.username}` : null,
    contact.name,
    contact.follower_count != null ? `${contact.follower_count} abonnés` : null,
    contact.is_verified ? "compte vérifié" : null,
    contact.follows_us === true ? "suit le studio" : contact.follows_us === false ? "ne suit pas le studio" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const rdv = lead.rdv_at
    ? `demandé pour ${formatParis(new Date(lead.rdv_at), deps.cfg.TIMEZONE)} (${lead.rdv_note ?? ""})`
    : lead.rdv_note ?? (lead.stage === "rdv_propose" ? "proposé, pas encore choisi" : "aucun");
  const lines = [
    "# Contexte de ta réponse (invisible pour le prospect)",
    `- Maintenant : ${formatParis(now, deps.cfg.TIMEZONE)} (heure de Paris).`,
    `- Arrivée de la conversation : ${SOURCE_LABELS[conversation.source] ?? conversation.source}${conversation.source_ref ? ` (${conversation.source_ref})` : ""}.`,
    isFirstAiMessage
      ? "- C'est ton premier message dans cette conversation : présente-toi comme l'IA du studio (règle 1)."
      : "- Tu t'es déjà présentée : ne te représente pas.",
    profil ? `- Profil Instagram : ${profil}.` : null,
    `- Étape : ${STAGE_LABELS[lead.stage]} · Budget : ${lead.budget_status} · Score : ${lead.score}/100.`,
    `- Fiche actuelle : ${JSON.stringify(lead.fiche)}`,
    `- Ébauche : ${describeEbauche(ebauche)}.`,
    `- Rendez-vous : ${rdv}.`,
    `- Lien de réservation : ${deps.cfg.BOOKING_URL ? "disponible via proposer_rdv" : "non configuré (propose des créneaux)"}.`,
    lead.summary ? `- Résumé des échanges précédents : ${lead.summary}` : null,
    lead.next_action ? `- Note de l'équipe : ${lead.next_action}` : null,
    conversation.channel === "bac_a_sable" ? "- Conversation de test interne : comporte-toi exactement comme avec un vrai prospect." : null,
  ];
  return lines.filter(Boolean).join("\n");
}

const DISCLOSURE = /\b(IA|I\.A\.|intelligence artificielle|AI|assistant(e)? virtuel(le)?)\b/i;

/** Nettoie les bulles : pas de markdown, taille compatible Instagram, 3 bulles au plus. */
export function sanitizeMessages(messages: string[]): string[] {
  return messages
    .map((m) =>
      m
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/__(.+?)__/g, "$1")
        .replace(/^#+\s*/gm, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
    )
    .filter(Boolean)
    .slice(0, 3)
    .map((m) => truncateBytes(m, 990));
}

export function sanitizeButtons(buttons: string[]): string[] {
  return buttons
    .map((b) => b.trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((b) => (b.length > 20 ? b.slice(0, 19) + "…" : b));
}

export async function runAgent(input: AgentInput, deps: AgentDeps): Promise<AgentOutput> {
  const { cfg, studio, llm } = deps;
  const model = cfg.AI_MODEL_CONVERSATION;
  const tools = agentTools(studio);
  const isFirstAiMessage = !input.history.some((m) => m.direction === "sortant" && m.author === "ia" && m.status !== "annule");
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
  const turns = historyToTurns(input.history, input.conversation);
  if (!turns.length || turns[turns.length - 1]!.role !== "user") {
    turns.push({ role: "user", content: "[Aucun nouveau message : relis la conversation et réponds seulement si c'est utile.]" });
  }
  const context = buildContext(input, deps, isFirstAiMessage);
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
      messages: ["Je laisse quelqu'un de l'équipe te répondre sur ce point, il revient vers toi très vite."],
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

  let out = sanitizeMessages(final.messages);
  if (isFirstAiMessage && out.length && !out.some((m) => DISCLOSURE.test(m))) {
    // Obligation de transparence : si le modèle a oublié de se présenter, on l'ajoute.
    out = [`Moi c'est ${studio.vars.ASSISTANT_NAME}, l'IA de ${studio.vars.STUDIO_NAME}. L'équipe suit nos échanges.`, ...out].slice(0, 3);
  }
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
