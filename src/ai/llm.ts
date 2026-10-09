import Anthropic from "@anthropic-ai/sdk";
import type { Db } from "../db/client.js";
import { recordUsage, logEvent } from "../db/repo/misc.js";
import { costUsd, supportsServerFallback } from "./models.js";
import { log } from "../logger.js";
import { errorMessage } from "../util/index.js";

export type ContentBlock = Anthropic.Beta.BetaContentBlock;
export type MessageParam = Anthropic.Beta.BetaMessageParam;
export type ToolDef = Anthropic.Beta.BetaTool;

export interface LlmRequest {
  /** À quoi sert l'appel (suivi des coûts) : conversation, relance, analyse, ebauche_brief… */
  purpose: string;
  model: string;
  /** Partie fixe du prompt système : mise en cache. */
  system: string;
  messages: MessageParam[];
  tools?: ToolDef[];
  /** Schéma JSON imposé à la réponse finale. */
  outputSchema?: Record<string, unknown>;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
  conversationId?: string | null;
}

export interface LlmResponse {
  content: ContentBlock[];
  stopReason: string | null;
  model: string;
  costUsd: number;
}

export interface Llm {
  create(req: LlmRequest): Promise<LlmResponse>;
}

export class LlmUnavailableError extends Error {}

/** Texte concaténé des blocs `text` d'une réponse (les blocs `thinking` sont ignorés). */
export function textOf(content: ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** Extrait un objet JSON d'un texte (réponse brute ou bloc ```json). */
export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
    if (fence?.[1]) {
      try {
        return JSON.parse(fence[1]);
      } catch {
        /* continue */
      }
    }
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("Réponse sans JSON exploitable");
  }
}

interface Degrade {
  fallbacks: boolean;
  outputFormat: boolean;
}

/**
 * Client Claude de production : cache du prompt système, effort réglable, sortie structurée,
 * repli automatique côté serveur en cas de refus, comptabilité des coûts.
 * Si l'API refuse une option (400), on retente une fois sans elle et on s'en souvient.
 */
export class AnthropicLlm implements Llm {
  private client: Anthropic;
  private degrade: Degrade = { fallbacks: true, outputFormat: true };

  constructor(
    private db: Db | null,
    private opts: { apiKey?: string; cacheTtl: "5m" | "1h"; serverFallback: boolean },
  ) {
    this.client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 3, timeout: 120_000 });
    this.degrade.fallbacks = opts.serverFallback;
  }

  async create(req: LlmRequest): Promise<LlmResponse> {
    const attempt = async (d: Degrade) => {
      const useFallbacks = d.fallbacks && supportsServerFallback(req.model);
      const maxTokens = req.maxTokens ?? 4096;
      const outputConfig = {
        ...(req.effort ? { effort: req.effort } : {}),
        ...(req.outputSchema && d.outputFormat ? { format: { type: "json_schema" as const, schema: req.outputSchema } } : {}),
      };
      const params: Anthropic.Beta.MessageCreateParamsNonStreaming = {
        model: req.model,
        max_tokens: maxTokens,
        system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral", ttl: this.opts.cacheTtl } }],
        messages: req.messages,
        ...(req.tools?.length ? { tools: req.tools } : {}),
        ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
        ...(useFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      };
      if (!d.outputFormat && req.outputSchema) {
        // Sans sortie structurée, on rappelle le format attendu en fin de conversation.
        params.messages = [
          ...req.messages,
          {
            role: "user",
            content: `[Consigne de format] Réponds uniquement avec un objet JSON valide qui respecte ce schéma : ${JSON.stringify(req.outputSchema)}`,
          },
        ];
      }
      if (maxTokens > 16_000) {
        return this.client.beta.messages.stream(params).finalMessage();
      }
      return this.client.beta.messages.create(params);
    };

    let res: Anthropic.Beta.BetaMessage;
    try {
      res = await attempt(this.degrade);
    } catch (err) {
      if (err instanceof Anthropic.BadRequestError && (this.degrade.fallbacks || this.degrade.outputFormat)) {
        const next: Degrade = this.degrade.fallbacks
          ? { ...this.degrade, fallbacks: false }
          : { ...this.degrade, outputFormat: false };
        log.warn("requête refusée par l'API, nouvel essai en mode dégradé", { purpose: req.purpose, error: errorMessage(err), next });
        if (this.db) await logEvent(this.db, "ia_mode_degrade", { purpose: req.purpose, error: errorMessage(err), next });
        try {
          res = await attempt(next);
          this.degrade = next;
        } catch (err2) {
          throw new LlmUnavailableError(errorMessage(err2));
        }
      } else if (err instanceof Anthropic.AuthenticationError) {
        throw new LlmUnavailableError("Clé API Anthropic invalide ou absente (ANTHROPIC_API_KEY).");
      } else if (err instanceof Anthropic.APIError || err instanceof Anthropic.APIConnectionError) {
        throw new LlmUnavailableError(errorMessage(err));
      } else {
        throw err;
      }
    }

    const servedModel = res.model || req.model;
    const cost = costUsd(servedModel, res.usage);
    if (this.db) {
      await recordUsage(this.db, {
        purpose: req.purpose,
        model: servedModel,
        input_tokens: res.usage.input_tokens ?? 0,
        output_tokens: res.usage.output_tokens ?? 0,
        cache_read_tokens: res.usage.cache_read_input_tokens ?? 0,
        cache_write_tokens: res.usage.cache_creation_input_tokens ?? 0,
        cost_usd: cost,
        conversation_id: req.conversationId ?? null,
      }).catch((e) => log.warn("coût IA non enregistré", { error: errorMessage(e) }));
    }
    return { content: res.content, stopReason: res.stop_reason, model: servedModel, costUsd: cost };
  }
}

/**
 * Faux client pour les tests et le mode hors ligne : rejoue des réponses écrites à l'avance,
 * ou délègue à une fonction qui regarde la requête.
 */
export class ScriptedLlm implements Llm {
  public calls: LlmRequest[] = [];
  constructor(private script: ((req: LlmRequest, n: number) => ContentBlock[] | Promise<ContentBlock[]>) | ContentBlock[][]) {}

  async create(req: LlmRequest): Promise<LlmResponse> {
    const n = this.calls.length;
    this.calls.push(structuredClone(req));
    const content = Array.isArray(this.script) ? this.script[n] : await this.script(req, n);
    if (!content) throw new Error(`ScriptedLlm : pas de réponse prévue pour l'appel n°${n + 1} (${req.purpose})`);
    const hasTool = content.some((b) => b.type === "tool_use");
    return { content, stopReason: hasTool ? "tool_use" : "end_turn", model: req.model, costUsd: 0 };
  }
}

/** Raccourcis pour écrire des réponses de test lisibles. */
export const fake = {
  text: (text: string): ContentBlock => ({ type: "text", text, citations: null }) as ContentBlock,
  json: (value: unknown): ContentBlock => ({ type: "text", text: JSON.stringify(value), citations: null }) as ContentBlock,
  tool: (name: string, input: Record<string, unknown>, id = `toolu_${Math.random().toString(36).slice(2, 10)}`): ContentBlock =>
    ({ type: "tool_use", id, name, input }) as ContentBlock,
};
