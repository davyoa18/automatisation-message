/**
 * Utilitaires sans dépendance à Node : partagés par le moteur et par le Labo (navigateur).
 */

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const encoder = new TextEncoder();

/** Taille d'un texte en octets UTF-8 (fonctionne aussi dans le navigateur). */
export function byteLength(text: string): number {
  return encoder.encode(text).length;
}

/** Coupe un texte à `max` octets UTF-8 sans casser un caractère. */
export function truncateBytes(text: string, max: number): string {
  if (byteLength(text) <= max) return text;
  const budget = max - byteLength("…");
  let used = 0;
  let out = "";
  for (const ch of text) {
    const size = byteLength(ch);
    if (used + size > budget) break;
    used += size;
    out += ch;
  }
  return out + "…";
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Générateur pseudo-aléatoire injectable (tests déterministes). */
export type Rng = () => number;
export const defaultRng: Rng = Math.random;

export function seededRng(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function between(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng();
}

/** Horloge injectable : en test on la fige ou on l'avance. */
export interface Clock {
  now(): Date;
}
export const systemClock: Clock = { now: () => new Date() };

export function addMs(d: Date, ms: number): Date {
  return new Date(d.getTime() + ms);
}

export function formatParis(d: Date, tz = "Europe/Paris"): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== "")) as Partial<T>;
}
