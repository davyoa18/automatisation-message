import { existsSync } from "node:fs";
import type { Browser } from "playwright";
import type { EbaucheBrief } from "../domain.js";
import { log } from "../logger.js";

export interface RenderedEbauche {
  screens: Buffer[];
  board: Buffer;
  teaser: Buffer;
}

export interface Renderer {
  render(screens: { titre: string; html: string }[], brief: EbaucheBrief, studioName: string): Promise<RenderedEbauche>;
  close(): Promise<void>;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Coque d'iPhone dessinée en CSS autour d'un écran généré (barre d'état, îlot, indicateur d'accueil). */
export function phoneFrame(screenHtml: string, dark = false): string {
  const ink = dark ? "#fff" : "#111";
  return `<div class="phone"><div class="screen">
  <div class="statusbar" style="color:${ink}"><span>9:41</span><span class="island"></span><span class="icons">
    <svg width="18" height="11" viewBox="0 0 18 11"><rect x="0" y="7" width="3" height="4" rx="1" fill="currentColor"/><rect x="5" y="5" width="3" height="6" rx="1" fill="currentColor"/><rect x="10" y="3" width="3" height="8" rx="1" fill="currentColor"/><rect x="15" y="0" width="3" height="11" rx="1" fill="currentColor"/></svg>
    <svg width="25" height="12" viewBox="0 0 25 12"><rect x="0.5" y="0.5" width="21" height="11" rx="3" fill="none" stroke="currentColor" opacity=".4"/><rect x="2" y="2" width="17" height="8" rx="2" fill="currentColor"/><rect x="23" y="4" width="2" height="4" rx="1" fill="currentColor" opacity=".4"/></svg>
  </span></div>
  <div class="content">${screenHtml}</div>
  <div class="home" style="background:${ink}"></div>
</div></div>`;
}

const FRAME_CSS = `
*{box-sizing:border-box} html,body{margin:0;padding:0;background:transparent}
.phone{width:418px;height:872px;border-radius:64px;background:#0b0b0d;padding:14px;box-shadow:0 30px 60px rgba(0,0,0,.28), inset 0 0 0 2px #2a2a2e}
.screen{position:relative;width:390px;height:844px;border-radius:50px;overflow:hidden;background:#fff}
.statusbar{position:absolute;top:0;left:0;right:0;height:54px;display:flex;align-items:center;justify-content:space-between;padding:0 32px 0 40px;font:600 16px -apple-system,"SF Pro Text","Helvetica Neue",Arial,sans-serif;z-index:20;pointer-events:none}
.island{position:absolute;left:50%;top:11px;transform:translateX(-50%);width:124px;height:36px;border-radius:20px;background:#000}
.icons{display:flex;gap:6px;align-items:center}
.content{position:absolute;inset:0;overflow:hidden}
.home{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);width:139px;height:5px;border-radius:3px;opacity:.85;z-index:20}
`;

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
