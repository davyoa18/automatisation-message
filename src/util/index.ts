import { randomBytes, randomUUID, timingSafeEqual, createHmac } from "node:crypto";

export const newId = (): string => randomUUID();

/** Identifiant opaque et non devinable (URLs publiques des médias). */
export const secretId = (bytes = 18): string => randomBytes(bytes).toString("base64url");

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function hmacSha256Hex(secret: string, payload: string | Buffer): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Coupe un texte à `max` octets UTF-8 sans casser un caractère. */
export function truncateBytes(text: string, max: number): string {
  if (Buffer.byteLength(text, "utf8") <= max) return text;
  let out = "";
  for (const ch of text) {
    if (Buffer.byteLength(out + ch + "…", "utf8") > max) break;
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
