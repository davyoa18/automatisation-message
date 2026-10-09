import { existsSync } from "node:fs";
import type { Browser } from "playwright";
import type { EbaucheBrief } from "../domain.js";
import { log } from "../logger.js";
import { esc, FRAME_CSS, phoneFrame } from "./screens.js";

export { phoneFrame } from "./screens.js";

export interface RenderedEbauche {
  screens: Buffer[];
  board: Buffer;
  teaser: Buffer;
}

export interface Renderer {
  render(screens: { titre: string; html: string }[], brief: EbaucheBrief, studioName: string): Promise<RenderedEbauche>;
  close(): Promise<void>;
}

function boardHtml(phones: string[], brief: EbaucheBrief, studioName: string, blur: boolean): string {
  const colors = brief.direction_artistique?.couleurs ?? [];
  const bg = colors[0] ?? "#eef0f3";
  return `<!doctype html><html><head><meta charset="utf-8"><style>${FRAME_CSS}
body{width:1500px;height:1180px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:36px;
  background:radial-gradient(circle at 20% 10%, ${bg}33, transparent 55%), linear-gradient(160deg,#f7f7f9,#e9ebef);font-family:-apple-system,"SF Pro Display","Helvetica Neue",Arial,sans-serif}
.row{display:flex;gap:44px;${blur ? "filter:blur(16px);" : ""}}
.row .phone{transform:scale(.92)}
h1{margin:0;font-size:40px;letter-spacing:-.02em;color:#111}
p{margin:0;color:#555;font-size:20px}
.cap{display:flex;flex-direction:column;align-items:center;gap:8px}
</style></head><body>
<div class="cap"><h1>${esc(brief.nom_app)}</h1><p>${esc(brief.promesse)}</p></div>
<div class="row">${phones.join("")}</div>
<p>Première ébauche · ${esc(studioName)}</p>
</body></html>`;
}

function chromiumPath(configured?: string): string | undefined {
  if (configured) return configured;
  if (existsSync("/opt/pw-browsers/chromium")) return "/opt/pw-browsers/chromium";
  return undefined;
}

/** Rendu des maquettes avec Chromium, JavaScript désactivé et réseau coupé (le HTML vient du modèle). */
export class PlaywrightRenderer implements Renderer {
  private browser: Browser | null = null;
  constructor(private executablePath?: string) {}

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    const { chromium } = await import("playwright");
    const exe = chromiumPath(this.executablePath);
    try {
      this.browser = await chromium.launch({ headless: true, ...(exe ? { executablePath: exe } : {}) });
    } catch (err) {
      if (!exe) throw err;
      log.warn("Chromium configuré introuvable, essai du Chromium de Playwright", { exe });
      this.browser = await chromium.launch({ headless: true });
    }
    return this.browser;
  }

  async render(screens: { titre: string; html: string }[], brief: EbaucheBrief, studioName: string): Promise<RenderedEbauche> {
    const browser = await this.getBrowser();
    const context = await browser.newContext({ viewport: { width: 1500, height: 1180 }, deviceScaleFactor: 2, javaScriptEnabled: false });
    await context.route("**/*", (route) => (route.request().url().startsWith("data:") ? route.continue() : route.abort()));
    try {
      const page = await context.newPage();
      const shots: Buffer[] = [];
      for (const s of screens) {
        await page.setViewportSize({ width: 418, height: 872 });
        await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${FRAME_CSS}</style></head><body>${phoneFrame(s.html)}</body></html>`, {
          waitUntil: "load",
        });
        shots.push(await page.locator(".phone").screenshot({ omitBackground: true }));
      }
      const phones = screens.map((s) => phoneFrame(s.html));
      await page.setViewportSize({ width: 1500, height: 1180 });
      await page.setContent(boardHtml(phones, brief, studioName, false), { waitUntil: "load" });
      const board = await page.screenshot({ type: "png" });
      await page.setContent(boardHtml(phones, brief, studioName, true), { waitUntil: "load" });
      const teaser = await page.screenshot({ type: "jpeg", quality: 80 });
      return { screens: shots, board, teaser };
    } finally {
      await context.close();
    }
  }

  async close(): Promise<void> {
    await this.browser?.close().catch(() => undefined);
    this.browser = null;
  }
}
