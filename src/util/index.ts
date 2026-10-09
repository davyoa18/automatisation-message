import { randomBytes, randomUUID, timingSafeEqual, createHmac } from "node:crypto";

export * from "./pure.js";

export const newId = (): string => randomUUID();

/** Identifiant opaque et non devinable (URLs publiques des médias). */
export const secretId = (bytes = 18): string => randomBytes(bytes).toString("base64url");

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function hmacSha256Hex(secret: string, payload: string | Buffer): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

