import type { Db } from "../db/client.js";
import { getSetting, setSetting } from "../db/repo/misc.js";
import { log } from "../logger.js";
import { truncateBytes } from "../util/index.js";

export interface IgProfile {
  username?: string;
  name?: string;
  profile_pic?: string;
  follower_count?: number;
  is_verified?: boolean;
  follows_us?: boolean;
  we_follow?: boolean;
}

export type IgButton = { type: "web_url"; url: string; title: string } | { type: "postback"; title: string; payload: string };

/** Tout ce que le moteur sait faire sur Instagram, via l'API officielle uniquement. */
export interface Messenger {
  readonly mode: "graph" | "dry_run" | "sandbox" | "fake";
  sendText(recipientId: string, text: string, quickReplies?: string[], opts?: { humanAgent?: boolean }): Promise<{ messageId: string | null }>;
  sendImage(recipientId: string, url: string): Promise<{ messageId: string | null }>;
  sendButtons(recipientId: string, text: string, buttons: IgButton[]): Promise<{ messageId: string | null }>;
  senderAction(recipientId: string, action: "typing_on" | "typing_off" | "mark_seen"): Promise<void>;
  /** Message privé en réponse à un commentaire (un seul par commentaire, sous 7 jours). */
  privateReply(commentId: string, text: string): Promise<{ messageId: string | null; recipientId: string | null }>;
  /** Réponse publique sous un commentaire. */
  replyToComment(commentId: string, text: string): Promise<{ id: string | null }>;
  getProfile(userId: string): Promise<IgProfile | null>;
}

/** Erreur de l'API Graph, avec les cas qui changent le comportement du moteur. */
export class IgError extends Error {
  constructor(
    message: string,
    public readonly code: number | null,
    public readonly subcode: number | null,
    public readonly status: number,
  ) {
    super(message);
  }
  /** Fenêtre de 24 h fermée ou destinataire injoignable : inutile de réessayer. */
  get isPermanent(): boolean {
    return (
      this.code === 10 ||
      this.code === 551 ||
      this.code === 100 ||
      this.subcode === 2018278 ||
      this.subcode === 2534022 ||
      this.subcode === 2534025 ||
      this.status === 400
    );
  }
  get isRateLimit(): boolean {
    return this.code === 4 || this.code === 613 || this.code === 32 || this.status === 429;
  }
  get isAuth(): boolean {
    return this.code === 190 || this.status === 401;
  }
}

const QR_MAX = 20;

/** Client de l'API Instagram (Instagram API with Instagram Login, hôte graph.instagram.com). */
export class GraphMessenger implements Messenger {
  readonly mode = "graph" as const;
  private base: string;

  constructor(
    private opts: { accountId: string; accessToken: string; version: string; host: string; db?: Db | null },
    private fetchImpl: typeof fetch = fetch,
  ) {
    this.base = `https://${opts.host}/${opts.version}`;
  }

  private async token(): Promise<string> {
    if (this.opts.db) {
      const stored = await getSetting<{ token: string; expires_at?: string }>(this.opts.db, "ig_token");
      if (stored?.token) return stored.token;
    }
    return this.opts.accessToken;
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: Record<string, unknown>, query?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.base}/${path.replace(/^\//, "")}`);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
    const res = await this.fetchImpl(url, {
      method,
      headers: { Authorization: `Bearer ${await this.token()}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      /* corps non JSON */
    }
    if (!res.ok || json.error) {
      const e = (json.error ?? {}) as Record<string, unknown>;
      throw new IgError(
        String(e.message ?? `HTTP ${res.status}`),
        typeof e.code === "number" ? e.code : null,
        typeof e.error_subcode === "number" ? e.error_subcode : null,
        res.status,
      );
    }
    return json as T;
  }

  private async send(recipient: Record<string, string>, message: Record<string, unknown>, tag?: string) {
    const body: Record<string, unknown> = { recipient, message };
    if (tag) {
      body.messaging_type = "MESSAGE_TAG";
      body.tag = tag;
    }
    return this.call<{ recipient_id?: string; message_id?: string }>("POST", `${this.opts.accountId}/messages`, body);
  }

  async sendText(recipientId: string, text: string, quickReplies: string[] = [], opts: { humanAgent?: boolean } = {}) {
    const message: Record<string, unknown> = { text: truncateBytes(text, 1000) };
    if (quickReplies.length) {
      message.quick_replies = quickReplies.slice(0, 13).map((q) => ({
        content_type: "text",
        title: q.slice(0, QR_MAX),
        payload: `QR:${q.slice(0, 60)}`,
      }));
    }
    const res = await this.send({ id: recipientId }, message, opts.humanAgent ? "HUMAN_AGENT" : undefined);
    return { messageId: res.message_id ?? null };
  }

  async sendImage(recipientId: string, url: string) {
    const res = await this.send({ id: recipientId }, { attachment: { type: "image", payload: { url } } });
    return { messageId: res.message_id ?? null };
  }

  async sendButtons(recipientId: string, text: string, buttons: IgButton[]) {
    const res = await this.send(
      { id: recipientId },
      { attachment: { type: "template", payload: { template_type: "button", text: truncateBytes(text, 640), buttons: buttons.slice(0, 3) } } },
    );
    return { messageId: res.message_id ?? null };
  }

  async senderAction(recipientId: string, action: "typing_on" | "typing_off" | "mark_seen") {
    await this.call("POST", `${this.opts.accountId}/messages`, { recipient: { id: recipientId }, sender_action: action });
  }

  async privateReply(commentId: string, text: string) {
    const res = await this.send({ comment_id: commentId }, { text: truncateBytes(text, 1000) });
    return { messageId: res.message_id ?? null, recipientId: res.recipient_id ?? null };
  }

  async replyToComment(commentId: string, text: string) {
    const res = await this.call<{ id?: string }>("POST", `${commentId}/replies`, undefined, { message: text.slice(0, 300) });
    return { id: res.id ?? null };
  }

  async getProfile(userId: string): Promise<IgProfile | null> {
    const full = "name,username,profile_pic,follower_count,is_user_follow_business,is_business_follow_user,is_verified_user";
    const read = (r: Record<string, unknown>): IgProfile => ({
      name: typeof r.name === "string" ? r.name : undefined,
      username: typeof r.username === "string" ? r.username : undefined,
      profile_pic: typeof r.profile_pic === "string" ? r.profile_pic : undefined,
      follower_count: typeof r.follower_count === "number" ? r.follower_count : undefined,
      is_verified: typeof r.is_verified_user === "boolean" ? r.is_verified_user : undefined,
      follows_us: typeof r.is_user_follow_business === "boolean" ? r.is_user_follow_business : undefined,
      we_follow: typeof r.is_business_follow_user === "boolean" ? r.is_business_follow_user : undefined,
    });
    try {
      return read(await this.call<Record<string, unknown>>("GET", userId, undefined, { fields: full }));
    } catch (err) {
      // Certains champs ne sont pas disponibles selon le type de compte : on retente avec le minimum.
      if (err instanceof IgError && !err.isAuth) {
        try {
          return read(await this.call<Record<string, unknown>>("GET", userId, undefined, { fields: "name,username,profile_pic" }));
        } catch (err2) {
          log.warn("profil Instagram indisponible", { userId, error: (err2 as Error).message });
          return null;
        }
      }
      throw err;
    }
  }

  /* -------- Configuration du compte (script ig:setup) -------- */

  async setIceBreakers(items: { question: string; payload: string }[]): Promise<unknown> {
    return this.call("POST", `${this.opts.accountId}/messenger_profile`, {
      platform: "instagram",
      ice_breakers: [{ call_to_actions: items.slice(0, 4), locale: "default" }],
    });
  }

  async subscribeWebhooks(fields: string[]): Promise<unknown> {
    return this.call("POST", "me/subscribed_apps", undefined, { subscribed_fields: fields.join(",") });
  }

  async me(): Promise<Record<string, unknown>> {
    return this.call("GET", "me", undefined, { fields: "user_id,username,name,account_type,followers_count" });
  }

  /** Les jetons longue durée expirent après 60 jours : on les renouvelle bien avant. */
  async refreshToken(): Promise<{ token: string; expiresInSec: number }> {
    const url = new URL(`https://${this.opts.host}/refresh_access_token`);
    url.searchParams.set("grant_type", "ig_refresh_token");
    url.searchParams.set("access_token", await this.token());
    const res = await this.fetchImpl(url);
    const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: { message?: string } };
    if (!res.ok || !json.access_token) throw new Error(json.error?.message ?? `Renouvellement du jeton impossible (HTTP ${res.status})`);
    if (this.opts.db) {
      await setSetting(this.opts.db, "ig_token", {
        token: json.access_token,
        expires_at: new Date(Date.now() + (json.expires_in ?? 5_184_000) * 1000).toISOString(),
        refreshed_at: new Date().toISOString(),
      });
    }
    return { token: json.access_token, expiresInSec: json.expires_in ?? 0 };
  }
}

/**
 * Enregistre ce qui aurait été envoyé, sans rien envoyer : pour tester en production à blanc
 * (DRY_RUN=true) et dans les tests automatiques.
 */
export class RecordingMessenger implements Messenger {
  public sent: { type: string; to: string; text?: string; quickReplies?: string[]; url?: string; humanAgent?: boolean }[] = [];
  public actions: { to: string; action: string }[] = [];
  public profiles = new Map<string, IgProfile>();
  public failNext: Error | null = null;
  private n = 0;

  constructor(public readonly mode: "dry_run" | "sandbox" | "fake" = "fake") {}

  private next(): string {
    this.n += 1;
    return `${this.mode}-mid-${this.n}`;
  }
  private maybeFail() {
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
  }

  async sendText(recipientId: string, text: string, quickReplies: string[] = [], opts: { humanAgent?: boolean } = {}) {
    this.maybeFail();
    this.sent.push({ type: "text", to: recipientId, text, quickReplies, humanAgent: opts.humanAgent });
    if (this.mode === "dry_run") log.info("[DRY_RUN] message non envoyé", { to: recipientId, text });
    return { messageId: this.next() };
  }
  async sendImage(recipientId: string, url: string) {
    this.maybeFail();
    this.sent.push({ type: "image", to: recipientId, url });
    return { messageId: this.next() };
  }
  async sendButtons(recipientId: string, text: string, buttons: IgButton[]) {
    this.maybeFail();
    this.sent.push({ type: "buttons", to: recipientId, text, quickReplies: buttons.map((b) => b.title) });
    return { messageId: this.next() };
  }
  async senderAction(recipientId: string, action: "typing_on" | "typing_off" | "mark_seen") {
    this.actions.push({ to: recipientId, action });
  }
  async privateReply(commentId: string, text: string) {
    this.maybeFail();
    this.sent.push({ type: "private_reply", to: commentId, text });
    return { messageId: this.next(), recipientId: null };
  }
  async replyToComment(commentId: string, text: string) {
    this.sent.push({ type: "comment_reply", to: commentId, text });
    return { id: this.next() };
  }
  async getProfile(userId: string) {
    return this.profiles.get(userId) ?? null;
  }
}
