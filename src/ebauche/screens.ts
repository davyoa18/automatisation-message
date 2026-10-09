/**
 * Ce qui entoure les écrans d'une ébauche, sans dépendance à Node : validation du brief et des
 * écrans renvoyés par le modèle, nettoyage du HTML, coque d'iPhone. Partagé par le moteur
 * (rendu en image avec Chromium) et par le Labo (affichage dans la page).
 */
import type { EbaucheBrief } from "../domain.js";

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Retire tout ce qui pourrait exécuter du code, charger une ressource externe ou quitter la page. */
export function sanitizeScreenHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\/?(iframe|object|embed|link|meta|base|form)[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(?:form)?action\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/@import[^;]*;?/gi, "")
    .replace(/url\(\s*['"]?(?!data:)[^)]*\)/gi, "none")
    .replace(/(src|href)\s*=\s*("|')(?!data:image\/|#)[^"']*\2/gi, "");
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** Lit le brief renvoyé par le modèle ; null s'il manque l'essentiel (nom, promesse, écrans). */
export function parseBrief(raw: unknown): EbaucheBrief | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const ecrans = (Array.isArray(o.ecrans) ? o.ecrans : [])
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .map((e) => ({ titre: text(e.titre), role: text(e.role) }))
    .filter((e) => e.titre);
  if (!text(o.nom_app) || !text(o.promesse) || !ecrans.length) return null;
  const da = (o.direction_artistique && typeof o.direction_artistique === "object" ? o.direction_artistique : {}) as Record<string, unknown>;
  return {
    nom_app: text(o.nom_app),
    promesse: text(o.promesse),
    cible: text(o.cible),
    probleme: text(o.probleme),
    fonctionnalites_mvp: strings(o.fonctionnalites_mvp),
    parcours_principal: strings(o.parcours_principal),
    ecrans,
    direction_artistique: { ambiance: text(da.ambiance), couleurs: strings(da.couleurs), typographie: text(da.typographie) },
    perimetre_21_jours: strings(o.perimetre_21_jours),
    questions_pour_l_appel: strings(o.questions_pour_l_appel),
    points_de_vigilance: strings(o.points_de_vigilance),
  };
}

/** Lit les écrans renvoyés par le modèle (3 au plus), HTML nettoyé ; liste vide si rien d'exploitable. */
export function parseScreens(raw: unknown): { titre: string; html: string }[] {
  if (!raw || typeof raw !== "object") return [];
  const list = (raw as Record<string, unknown>).ecrans;
  if (!Array.isArray(list)) return [];
  return list
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object" && typeof (e as Record<string, unknown>).html === "string")
    .slice(0, 3)
    .map((e) => ({ titre: text(e.titre), html: sanitizeScreenHtml(String(e.html)) }));
}

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

export const FRAME_CSS = `
*{box-sizing:border-box} html,body{margin:0;padding:0;background:transparent}
.phone{width:418px;height:872px;border-radius:64px;background:#0b0b0d;padding:14px;box-shadow:0 30px 60px rgba(0,0,0,.28), inset 0 0 0 2px #2a2a2e}
.screen{position:relative;width:390px;height:844px;border-radius:50px;overflow:hidden;background:#fff}
.statusbar{position:absolute;top:0;left:0;right:0;height:54px;display:flex;align-items:center;justify-content:space-between;padding:0 32px 0 40px;font:600 16px -apple-system,"SF Pro Text","Helvetica Neue",Arial,sans-serif;z-index:20;pointer-events:none;color:#fff!important;mix-blend-mode:difference}
.island{position:absolute;left:50%;top:11px;transform:translateX(-50%);width:124px;height:36px;border-radius:20px;background:#000}
.icons{display:flex;gap:6px;align-items:center}
.content{position:absolute;inset:0;overflow:hidden}
.home{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);width:139px;height:5px;border-radius:3px;opacity:.85;z-index:20;background:#fff!important;mix-blend-mode:difference}
`;
