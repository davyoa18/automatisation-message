import type { Config } from "../config.js";
import { log } from "../logger.js";
import { errorMessage } from "../util/index.js";

export interface Notification {
  kind: string;
  title: string;
  body: string;
  urgent?: boolean;
  link?: string;
}

export interface Notifier {
  send(n: Notification): Promise<{ delivered: string[]; failed: string[] }>;
}

/** Envoie les alertes à l'équipe sur tous les canaux configurés (Telegram, email, webhook). */
export class MultiNotifier implements Notifier {
  constructor(
    private cfg: Config,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  channels(): string[] {
    const c: string[] = [];
    if (this.cfg.TELEGRAM_BOT_TOKEN && this.cfg.TELEGRAM_CHAT_ID) c.push("telegram");
    if (this.cfg.RESEND_API_KEY && this.cfg.NOTIFY_EMAIL_TO && this.cfg.NOTIFY_EMAIL_FROM) c.push("email");
    if (this.cfg.NOTIFY_WEBHOOK_URL) c.push("webhook");
    return c;
  }

  async send(n: Notification) {
    const delivered: string[] = [];
    const failed: string[] = [];
    const text = `${n.urgent ? "🔴 " : ""}${n.title}\n\n${n.body}${n.link ? `\n\n${n.link}` : ""}`;
    const tasks: [string, () => Promise<Response>][] = [];
    if (this.cfg.TELEGRAM_BOT_TOKEN && this.cfg.TELEGRAM_CHAT_ID) {
      tasks.push([
        "telegram",
        () =>
          this.fetchImpl(`https://api.telegram.org/bot${this.cfg.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: this.cfg.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
          }),
      ]);
    }
    if (this.cfg.RESEND_API_KEY && this.cfg.NOTIFY_EMAIL_TO && this.cfg.NOTIFY_EMAIL_FROM) {
      tasks.push([
        "email",
        () =>
          this.fetchImpl("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${this.cfg.RESEND_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: this.cfg.NOTIFY_EMAIL_FROM,
              to: this.cfg.NOTIFY_EMAIL_TO!.split(",").map((s) => s.trim()),
              subject: `${n.urgent ? "[URGENT] " : ""}${n.title}`,
              text,
            }),
          }),
      ]);
    }
    if (this.cfg.NOTIFY_WEBHOOK_URL) {
      tasks.push([
        "webhook",
        () =>
          this.fetchImpl(this.cfg.NOTIFY_WEBHOOK_URL!, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // Format compatible Slack / Discord (champ `text` / `content`) et outils d'automatisation.
            body: JSON.stringify({ text, content: text, ...n }),
          }),
      ]);
    }
    await Promise.all(
      tasks.map(async ([name, run]) => {
        try {
          const res = await run();
          if (res.ok) delivered.push(name);
          else {
            failed.push(name);
            log.warn("notification refusée", { channel: name, status: res.status });
          }
        } catch (err) {
          failed.push(name);
          log.warn("notification en échec", { channel: name, error: errorMessage(err) });
        }
      }),
    );
    if (!tasks.length) log.info("notification (aucun canal configuré)", { title: n.title });
    return { delivered, failed };
  }
}

export class MemoryNotifier implements Notifier {
  public sent: Notification[] = [];
  async send(n: Notification) {
    this.sent.push(n);
    return { delivered: ["memoire"], failed: [] };
  }
}
