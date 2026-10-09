import { between, clamp, type Rng } from "../util/pure.js";

/**
 * Rythme d'envoi : l'IA ne répond pas en 200 ms avec trois paragraphes. Elle « lit », tape
 * (indicateur de saisie), envoie des bulles courtes séparées de petites pauses.
 */
export interface PacingProfile {
  /** Délai de regroupement après le dernier message reçu (la personne écrit souvent en plusieurs bulles). */
  debounceMs: number;
  /** Temps de « lecture » avant de commencer à taper. */
  readMs: [number, number];
  /** Vitesse de frappe simulée, en caractères par seconde. */
  charsPerSec: [number, number];
  /** Durée de saisie par bulle, bornée. */
  typingMs: [number, number];
  /** Pause entre deux bulles. */
  gapMs: [number, number];
}

export const PROFILES: Record<"naturel" | "rapide" | "instantane", Omit<PacingProfile, "debounceMs">> = {
  naturel: { readMs: [2_000, 6_000], charsPerSec: [9, 14], typingMs: [2_500, 15_000], gapMs: [1_200, 3_500] },
  rapide: { readMs: [500, 1_500], charsPerSec: [22, 30], typingMs: [1_000, 5_000], gapMs: [500, 1_200] },
  instantane: { readMs: [0, 0], charsPerSec: [1_000, 1_000], typingMs: [0, 0], gapMs: [0, 0] },
};

export function profileFor(name: "naturel" | "rapide" | "instantane", debounceSeconds: number): PacingProfile {
  return { ...PROFILES[name], debounceMs: name === "instantane" ? 0 : debounceSeconds * 1000 };
}

export interface DeliveryStep {
  /** Attente avant d'afficher « en train d'écrire ». */
  waitBeforeTypingMs: number;
  /** Durée d'affichage de l'indicateur de saisie avant l'envoi. */
  typingMs: number;
}

/**
 * Planifie l'envoi de bulles. `alreadyElapsedMs` = temps déjà écoulé depuis le dernier message
 * reçu (regroupement + génération) : il est déduit du temps de lecture.
 */
export function planDelivery(texts: string[], p: PacingProfile, rng: Rng, alreadyElapsedMs = 0): DeliveryStep[] {
  const cps = between(rng, p.charsPerSec[0], p.charsPerSec[1]);
  return texts.map((text, i) => {
    const typing = p.typingMs[1] === 0 ? 0 : clamp((text.length / cps) * 1000, p.typingMs[0], p.typingMs[1]);
    let wait: number;
    if (i === 0) {
      const read = between(rng, p.readMs[0], p.readMs[1]);
      wait = Math.max(0, read - Math.max(0, alreadyElapsedMs - p.debounceMs));
    } else {
      wait = between(rng, p.gapMs[0], p.gapMs[1]);
    }
    return { waitBeforeTypingMs: Math.round(wait), typingMs: Math.round(typing) };
  });
}

export function totalDurationMs(steps: DeliveryStep[]): number {
  return steps.reduce((s, x) => s + x.waitBeforeTypingMs + x.typingMs, 0);
}
