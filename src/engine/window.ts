/**
 * Règle Instagram : un message automatique ne peut partir que dans les 24 h qui suivent le
 * dernier message de la personne. On garde une marge de sécurité.
 */
export const WINDOW_MS = 24 * 3_600_000;
export const SAFETY_MARGIN_MS = 10 * 60_000;

export function windowClosesAt(lastInboundAt: Date | null): Date | null {
  return lastInboundAt ? new Date(new Date(lastInboundAt).getTime() + WINDOW_MS) : null;
}

export function canSendAutomated(lastInboundAt: Date | null, now: Date, marginMs = SAFETY_MARGIN_MS): boolean {
  const closes = windowClosesAt(lastInboundAt);
  return !!closes && now.getTime() < closes.getTime() - marginMs;
}

/** Temps restant dans la fenêtre, en millisecondes (0 si fermée). */
export function windowRemainingMs(lastInboundAt: Date | null, now: Date): number {
  const closes = windowClosesAt(lastInboundAt);
  return closes ? Math.max(0, closes.getTime() - now.getTime()) : 0;
}

/** Une relance n'est programmée que si elle tombe encore dans la fenêtre (avec marge). */
export function relanceFits(lastInboundAt: Date | null, at: Date, marginMs = 15 * 60_000): boolean {
  return canSendAutomated(lastInboundAt, at, marginMs);
}
