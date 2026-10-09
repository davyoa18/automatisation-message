/**
 * Tarifs publics (USD par million de jetons) pour estimer le coût de chaque appel.
 * Source : grille Anthropic au 6 octobre 2026. À ajuster si la grille change.
 */
export interface Pricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

const PRICING: Record<string, Pricing> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite5m: 5, cacheWrite1h: 8 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite5m: 2.5, cacheWrite1h: 4 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite5m: 0.125, cacheWrite1h: 0.2 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite5m: 2.5, cacheWrite1h: 4 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10 },
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25, cacheWrite5m: 12.5, cacheWrite1h: 20 },
};

export function pricingFor(model: string): Pricing {
  return PRICING[model] ?? PRICING["claude-sonnet-5-5"]!;
}

export interface UsageLike {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_creation?: { ephemeral_1h_input_tokens?: number | null; ephemeral_5m_input_tokens?: number | null } | null;
}

export function costUsd(model: string, u: UsageLike): number {
  const p = pricingFor(model);
  const write1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const write5m = u.cache_creation?.ephemeral_5m_input_tokens ?? Math.max(0, (u.cache_creation_input_tokens ?? 0) - write1h);
  const total =
    (u.input_tokens ?? 0) * p.input +
    (u.output_tokens ?? 0) * p.output +
    (u.cache_read_input_tokens ?? 0) * p.cacheRead +
    write5m * p.cacheWrite5m +
    write1h * p.cacheWrite1h;
  return total / 1_000_000;
}

/** Modèles qui acceptent les messages `system` en milieu de conversation. */
export function supportsMidConversationSystem(model: string): boolean {
  return /claude-(opus-5|opus-5-5|opus-4-8|sonnet-5-5|haiku-5-5|fable-5|fable-5-1|mythos)/.test(model);
}

/** Le repli automatique côté serveur n'existe que pour certains modèles. */
export function supportsServerFallback(model: string): boolean {
  return /claude-(opus-5-5|opus-5|sonnet-5-5|fable-5-1)/.test(model);
}
