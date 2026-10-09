import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Config } from "../config.js";
import { hmacSha256Hex, safeEqual } from "../util/index.js";

const COOKIE = "yd_cockpit";
const MAX_AGE_S = 30 * 86_400;

function sign(secret: string, payload: string): string {
  return `${Buffer.from(payload).toString("base64url")}.${hmacSha256Hex(secret, payload)}`;
}

function verify(secret: string, token: string | undefined): { exp: number } | null {
  if (!token) return null;
  const [b64, sig] = token.split(".");
  if (!b64 || !sig) return null;
  const payload = Buffer.from(b64, "base64url").toString("utf8");
  if (!safeEqual(hmacSha256Hex(secret, payload), sig)) return null;
  try {
    const data = JSON.parse(payload) as { exp: number };
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

/** Accès au cockpit : mot de passe d'équipe, cookie signé (30 jours). Ouvert sans mot de passe hors production. */
export function cockpitAuth(cfg: Config): { required: boolean; middleware: MiddlewareHandler; login(c: Context, password: string): boolean; logout(c: Context): void } {
  const required = !!cfg.COCKPIT_PASSWORD || cfg.NODE_ENV === "production";
  const secret = cfg.SESSION_SECRET ?? cfg.COCKPIT_PASSWORD ?? "dev-secret";
  return {
    required,
    middleware: async (c, next) => {
      if (!required) return next();
      if (!cfg.COCKPIT_PASSWORD) return c.text("Cockpit désactivé : définissez COCKPIT_PASSWORD et SESSION_SECRET.", 503);
      if (verify(secret, getCookie(c, COOKIE))) return next();
      const wantsHtml = (c.req.header("accept") ?? "").includes("text/html");
      return wantsHtml ? c.redirect(`/cockpit/connexion?retour=${encodeURIComponent(c.req.path)}`) : c.json({ error: "non connecté" }, 401);
    },
    login(c, password) {
      if (!cfg.COCKPIT_PASSWORD || !safeEqual(password, cfg.COCKPIT_PASSWORD)) return false;
      setCookie(c, COOKIE, sign(secret, JSON.stringify({ exp: Date.now() + MAX_AGE_S * 1000 })), {
        httpOnly: true,
        sameSite: "Lax",
        secure: cfg.PUBLIC_BASE_URL.startsWith("https://"),
        path: "/",
        maxAge: MAX_AGE_S,
      });
      return true;
    },
    logout(c) {
      deleteCookie(c, COOKIE, { path: "/" });
    },
  };
}
