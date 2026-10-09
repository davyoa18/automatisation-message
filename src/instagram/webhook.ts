import { hmacSha256Hex, safeEqual } from "../util/index.js";

/** Événements Instagram normalisés, indépendants du format brut de Meta. */
export type IgEvent =
  | {
      kind: "message";
      accountId: string;
      senderId: string;
      recipientId: string;
      mid: string;
      text: string;
      timestamp: Date;
      isEcho: boolean;
      isDeleted: boolean;
      isUnsupported: boolean;
      attachments: { type: string; url?: string }[];
      quickReplyPayload?: string;
      storyReply?: { id?: string; url?: string };
      storyMention?: { url?: string };
      replyToMid?: string;
      referral?: IgReferral;
    }
  | { kind: "postback"; accountId: string; senderId: string; mid?: string; title: string; payload: string; timestamp: Date; referral?: IgReferral }
  | { kind: "referral"; accountId: string; senderId: string; referral: IgReferral; timestamp: Date }
  | { kind: "reaction"; accountId: string; senderId: string; mid: string; reaction: string; action: string; timestamp: Date }
  | { kind: "seen"; accountId: string; senderId: string; mid?: string; timestamp: Date }
  | {
      kind: "comment";
      accountId: string;
      commentId: string;
      mediaId: string | null;
      mediaProductType: string | null;
      parentId: string | null;
      text: string;
      fromId: string | null;
      fromUsername: string | null;
      timestamp: Date;
    };

export interface IgReferral {
  ref?: string;
  source?: string;
  type?: string;
  adId?: string;
  adTitle?: string;
}

/**
 * Vérifie la signature `X-Hub-Signature-256` (HMAC-SHA256 du corps brut avec le secret de l'app).
 * Sans secret configuré, on refuse tout en production.
 */
export function verifySignature(rawBody: string | Buffer, header: string | undefined, appSecret: string | undefined): boolean {
  if (!appSecret || !header) return false;
  const [algo, sig] = header.split("=");
  if (algo !== "sha256" || !sig) return false;
  return safeEqual(hmacSha256Hex(appSecret, rawBody), sig);
}

const asString = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const ts = (v: unknown): Date => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return new Date();
  return new Date(n < 1e12 ? n * 1000 : n);
};

function parseReferral(r: unknown): IgReferral | undefined {
  if (!r || typeof r !== "object") return undefined;
  const o = r as Record<string, unknown>;
  const ads = (o.ads_context_data ?? {}) as Record<string, unknown>;
  return {
    ref: o.ref ? asString(o.ref) : undefined,
    source: o.source ? asString(o.source) : undefined,
    type: o.type ? asString(o.type) : undefined,
    adId: o.ad_id ? asString(o.ad_id) : undefined,
    adTitle: ads.ad_title ? asString(ads.ad_title) : undefined,
  };
}

/** Transforme le corps d'un webhook Meta (objet `instagram`) en événements normalisés. */
export function parseWebhook(body: unknown): IgEvent[] {
  const out: IgEvent[] = [];
  if (!body || typeof body !== "object") return out;
  const root = body as Record<string, unknown>;
  const entries = Array.isArray(root.entry) ? root.entry : [];
  for (const entryRaw of entries) {
    const entry = (entryRaw ?? {}) as Record<string, unknown>;
    const accountId = asString(entry.id);
    const messaging = Array.isArray(entry.messaging) ? entry.messaging : [];
    for (const evRaw of messaging) {
      const ev = (evRaw ?? {}) as Record<string, unknown>;
      const senderId = asString((ev.sender as Record<string, unknown> | undefined)?.id);
      const recipientId = asString((ev.recipient as Record<string, unknown> | undefined)?.id);
      const timestamp = ts(ev.timestamp);
      const referral = parseReferral(ev.referral);
      if (ev.message && typeof ev.message === "object") {
        const m = ev.message as Record<string, unknown>;
        const attachmentsRaw = Array.isArray(m.attachments) ? m.attachments : [];
        const attachments = attachmentsRaw.map((a) => {
          const att = (a ?? {}) as Record<string, unknown>;
          const payload = (att.payload ?? {}) as Record<string, unknown>;
          return { type: asString(att.type), url: payload.url ? asString(payload.url) : undefined };
        });
        const replyTo = (m.reply_to ?? {}) as Record<string, unknown>;
        const story = replyTo.story as Record<string, unknown> | undefined;
        const mention = attachments.find((a) => a.type === "story_mention");
        out.push({
          kind: "message",
          accountId,
          senderId,
          recipientId,
          mid: asString(m.mid),
          text: asString(m.text),
          timestamp,
          isEcho: m.is_echo === true,
          isDeleted: m.is_deleted === true,
          isUnsupported: m.is_unsupported === true,
          attachments: attachments.filter((a) => a.type !== "story_mention"),
          quickReplyPayload: (m.quick_reply as Record<string, unknown> | undefined)?.payload
            ? asString((m.quick_reply as Record<string, unknown>).payload)
            : undefined,
          storyReply: story ? { id: story.id ? asString(story.id) : undefined, url: story.url ? asString(story.url) : undefined } : undefined,
          storyMention: mention ? { url: mention.url } : undefined,
          replyToMid: replyTo.mid ? asString(replyTo.mid) : undefined,
          referral: referral ?? parseReferral(m.referral),
        });
      } else if (ev.postback && typeof ev.postback === "object") {
        const p = ev.postback as Record<string, unknown>;
        out.push({
          kind: "postback",
          accountId,
          senderId,
          mid: p.mid ? asString(p.mid) : undefined,
          title: asString(p.title),
          payload: asString(p.payload),
          timestamp,
          referral: parseReferral(p.referral) ?? referral,
        });
      } else if (ev.reaction && typeof ev.reaction === "object") {
        const r = ev.reaction as Record<string, unknown>;
        out.push({
          kind: "reaction",
          accountId,
          senderId,
          mid: asString(r.mid),
          reaction: asString(r.emoji ?? r.reaction),
          action: asString(r.action),
          timestamp,
        });
      } else if (ev.read && typeof ev.read === "object") {
        out.push({ kind: "seen", accountId, senderId, mid: asString((ev.read as Record<string, unknown>).mid) || undefined, timestamp });
      } else if (referral) {
        out.push({ kind: "referral", accountId, senderId, referral, timestamp });
      }
    }
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const chRaw of changes) {
      const ch = (chRaw ?? {}) as Record<string, unknown>;
      const field = asString(ch.field);
      if (field !== "comments" && field !== "live_comments") continue;
      const v = (ch.value ?? {}) as Record<string, unknown>;
      const from = (v.from ?? {}) as Record<string, unknown>;
      const media = (v.media ?? {}) as Record<string, unknown>;
      out.push({
        kind: "comment",
        accountId,
        commentId: asString(v.id),
        mediaId: media.id ? asString(media.id) : null,
        mediaProductType: media.media_product_type ? asString(media.media_product_type) : null,
        parentId: v.parent_id ? asString(v.parent_id) : null,
        text: asString(v.text),
        fromId: from.id ? asString(from.id) : null,
        fromUsername: from.username ? asString(from.username) : null,
        timestamp: ts(entry.time),
      });
    }
  }
  return out;
}
