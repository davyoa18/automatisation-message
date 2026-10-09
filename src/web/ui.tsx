import { raw } from "hono/html";
import type { Child } from "hono/jsx";
import { STAGE_LABELS, type Stage } from "../domain.js";

export const CSS = `
:root{--bg:#f5f6f8;--panel:#fff;--ink:#14171c;--muted:#5b6472;--line:#e2e5ea;--accent:#0f766e;--accent-soft:#e6f4f2;--on-accent:#fff;
--hot:#d93a3a;--warm:#d97706;--ok:#15803d;--cold:#64748b;--bubble-in:#eef0f3;--bubble-ai:#e6f4f2;--bubble-human:#fff4e5;--shadow:0 1px 2px rgba(16,24,40,.06);
--font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
@media (prefers-color-scheme:dark){:root{--bg:#0e1116;--panel:#161a21;--ink:#e6e9ee;--muted:#98a2b3;--line:#262c36;--accent:#2dd4bf;--accent-soft:#12302d;--on-accent:#04201d;
--hot:#f87171;--warm:#fbbf24;--ok:#4ade80;--cold:#94a3b8;--bubble-in:#1e232c;--bubble-ai:#12302d;--bubble-human:#33270f;--shadow:none;color-scheme:dark}}
*{box-sizing:border-box}html,body{margin:0}body{background:var(--bg);color:var(--ink);font:15px/1.5 var(--font)}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.app{display:grid;grid-template-columns:220px minmax(0,1fr);min-height:100vh}
.side{border-right:1px solid var(--line);padding:20px 14px;display:flex;flex-direction:column;gap:4px;background:var(--panel);position:sticky;top:0;height:100vh}
.brand{font-weight:800;font-size:17px;padding:4px 10px 16px;letter-spacing:-.01em}.brand small{display:block;font-weight:500;color:var(--muted);font-size:12px}
.nav a{display:block;padding:8px 10px;border-radius:8px;color:var(--ink)}.nav a:hover{background:var(--bg);text-decoration:none}.nav a.on{background:var(--accent-soft);color:var(--accent);font-weight:600}
.side .foot{margin-top:auto;font-size:12px;color:var(--muted);padding:0 10px}
main{padding:24px clamp(16px,3vw,36px);min-width:0;display:flex;flex-direction:column;gap:20px}
h1{margin:0;font-size:24px;letter-spacing:-.02em}h2{margin:0 0 10px;font-size:16px}h3{margin:0;font-size:14px}
.sub{color:var(--muted);margin:2px 0 0}
.head{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;box-shadow:var(--shadow);min-width:0}
.grid{display:grid;gap:16px}.g2{grid-template-columns:repeat(auto-fit,minmax(320px,1fr))}.g3{grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.kpi{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px}.kpi b{display:block;font-size:26px;font-variant-numeric:tabular-nums;letter-spacing:-.02em}.kpi span{color:var(--muted);font-size:13px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
tr:last-child td{border-bottom:0}.num{font-variant-numeric:tabular-nums;text-align:right}
.pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600;background:var(--bg);border:1px solid var(--line);white-space:nowrap}
.pill.accent{background:var(--accent-soft);color:var(--accent);border-color:transparent}
.temp{display:inline-flex;align-items:center;gap:6px;font-size:13px}.temp i{width:9px;height:9px;border-radius:50%;display:inline-block}
.t-brulant i{background:var(--hot)}.t-chaud i{background:var(--warm)}.t-tiede i{background:#eab308}.t-froid i{background:var(--cold)}
.muted{color:var(--muted)}.small{font-size:13px}.mono{font-family:var(--mono);font-size:12px}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.stack{display:flex;flex-direction:column;gap:10px}
button,.btn{font:inherit;font-size:14px;border:1px solid var(--line);background:var(--panel);color:var(--ink);padding:7px 12px;border-radius:8px;cursor:pointer;display:inline-flex;gap:6px;align-items:center}
button.primary,.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent);font-weight:600}button.danger{color:var(--hot)}
button:focus-visible,a:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
input,textarea,select{font:inherit;color:var(--ink);background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:8px 10px;width:100%}
textarea{min-height:80px;resize:vertical}label{font-size:13px;color:var(--muted);display:flex;flex-direction:column;gap:4px}
.filters{display:flex;gap:6px;flex-wrap:wrap}.filters a{padding:5px 10px;border-radius:999px;border:1px solid var(--line);color:var(--ink);font-size:13px;background:var(--panel)}.filters a.on{background:var(--ink);color:var(--panel);border-color:var(--ink)}
.convo{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:16px;align-items:start}
.thread{display:flex;flex-direction:column;gap:8px;max-height:70vh;overflow:auto;padding:4px}
.msg{max-width:78%;padding:9px 12px;border-radius:16px;white-space:pre-wrap;overflow-wrap:anywhere}
.msg.in{align-self:flex-start;background:var(--bubble-in);border-bottom-left-radius:4px}
.msg.out{align-self:flex-end;background:var(--bubble-ai);border-bottom-right-radius:4px}.msg.human{background:var(--bubble-human)}
.msg .meta{display:flex;gap:8px;font-size:11px;color:var(--muted);margin-top:4px;align-items:center;justify-content:space-between}
.msg .meta form{display:inline}.msg .meta button{padding:0 4px;border:0;background:none;font-size:13px}
.msg.failed{outline:1px dashed var(--hot)}.msg.cancelled{opacity:.5}
.qr{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.qr span{border:1px solid var(--accent);color:var(--accent);border-radius:999px;padding:1px 8px;font-size:12px}
dl{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:6px 12px;margin:0}dt{color:var(--muted);font-size:13px}dd{margin:0;overflow-wrap:anywhere}
.banner{border:1px solid var(--warm);background:color-mix(in srgb,var(--warm) 10%,var(--panel));padding:10px 14px;border-radius:10px}
.ok{color:var(--ok)}.ko{color:var(--hot)}
.board{width:100%;border-radius:10px;border:1px solid var(--line);background:#fff}
.shots{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.shots img{width:100%;border-radius:14px}
.copy{cursor:pointer}
@media (max-width:900px){.app{grid-template-columns:1fr}.side{position:static;height:auto;flex-direction:row;flex-wrap:wrap;align-items:center}.side .foot{display:none}.nav{display:flex;flex-wrap:wrap;gap:2px}.convo{grid-template-columns:1fr}.msg{max-width:92%}}
`;

const COPY_JS = `document.addEventListener('click',async e=>{const b=e.target.closest('[data-copy]');if(!b)return;const t=document.getElementById(b.dataset.copy);if(!t)return;try{await navigator.clipboard.writeText(t.innerText||t.value);b.textContent='Copié ✓'}catch{const r=document.createRange();r.selectNodeContents(t);const s=getSelection();s.removeAllRanges();s.addRange(r);b.textContent='Sélectionné'}});`;

const NAV: [string, string][] = [
  ["/cockpit", "Tableau de bord"],
  ["/cockpit/conversations", "Conversations"],
  ["/cockpit/prospects", "Prospects"],
  ["/cockpit/ebauches", "Ébauches"],
  ["/cockpit/bac-a-sable", "Bac à sable"],
  ["/cockpit/reglages", "Réglages"],
];

export function Layout(props: { title: string; path: string; studio: string; children?: Child; scripts?: string; mode?: string }) {
  return (
    <html lang="fr">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${props.title} · Moteur DM`}</title>
        <style>{raw(CSS)}</style>
      </head>
      <body>
        <div class="app">
          <aside class="side">
            <div class="brand">
              Moteur DM<small>{props.studio}</small>
            </div>
            <nav class="nav">
              {NAV.map(([href, label]) => (
                <a href={href} class={(href === "/cockpit" ? props.path === href : props.path.startsWith(href)) ? "on" : ""}>
                  {label}
                </a>
              ))}
            </nav>
            <div class="foot">
              {props.mode ? <p>{props.mode}</p> : null}
              <form method="post" action="/cockpit/deconnexion">
                <button type="submit">Se déconnecter</button>
              </form>
            </div>
          </aside>
          <main>{props.children}</main>
        </div>
        <script>{raw(COPY_JS + (props.scripts ?? ""))}</script>
      </body>
    </html>
  );
}

export function StagePill({ stage }: { stage: string | null }) {
  if (!stage) return <span class="pill">—</span>;
  const label = STAGE_LABELS[stage as Stage] ?? stage;
  const accent = ["qualifie", "ebauche", "rdv_propose", "rdv_pris", "gagne"].includes(stage);
  return <span class={accent ? "pill accent" : "pill"}>{label}</span>;
}

export function Temp({ t }: { t: string | null }) {
  const labels: Record<string, string> = { brulant: "Brûlant", chaud: "Chaud", tiede: "Tiède", froid: "Froid" };
  if (!t) return <span class="muted">—</span>;
  return (
    <span class={`temp t-${t}`}>
      <i></i>
      {labels[t] ?? t}
    </span>
  );
}

export function ago(d: Date | string | null | undefined, now = new Date()): string {
  if (!d) return "—";
  const s = Math.round((now.getTime() - new Date(d).getTime()) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86_400) return `il y a ${Math.round(s / 3600)} h`;
  return `il y a ${Math.round(s / 86_400)} j`;
}

export function fmtDate(d: Date | string | null | undefined, tz = "Europe/Paris"): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("fr-FR", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(d));
}

export function fmtDay(d: Date | string | null | undefined, tz = "Europe/Paris"): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("fr-FR", { timeZone: tz, day: "numeric", month: "long", year: "numeric" }).format(new Date(d));
}

export const SOURCE_LABELS: Record<string, string> = { registre: "Registre des entreprises", actualite: "Actualité", manuel: "Ajout manuel" };

export function handle(c: { username?: string | null; name?: string | null }): string {
  return c.username ? `@${c.username}` : c.name ?? "Anonyme";
}
