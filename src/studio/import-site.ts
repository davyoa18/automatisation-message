/**
 * Importe le contenu du site du studio dans la base de connaissances de l'IA.
 * Parcourt les pages du même domaine (25 au maximum), en extrait le texte, et l'écrit dans
 * studio/90-site.md. Relire ce fichier avant de redéployer : l'IA s'appuiera dessus.
 *
 *   npm run studio:import -- https://yd-studio.fr
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { projectRoot } from "./knowledge.js";

const start = process.argv[2] ?? "https://yd-studio.fr";
const origin = new URL(start).origin;
const MAX_PAGES = 25;
const MAX_CHARS = 30_000;

function htmlToText(html: string): { title: string; text: string; links: string[] } {
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").trim();
  const links = [...html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)].map((m) => m[1]!);
  const text = html
    .replace(/<(script|style|noscript|svg|nav|footer)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|section|h[1-6]|li|br|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  return { title, text, links };
}

const queue = [start];
const seen = new Set<string>();
const pages: { url: string; title: string; text: string }[] = [];
while (queue.length && pages.length < MAX_PAGES) {
  const url = queue.shift()!;
  if (seen.has(url)) continue;
  seen.add(url);
  try {
    const res = await fetch(url, { headers: { "User-Agent": "YD-Studio-knowledge-import" } });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/html")) continue;
    const { title, text, links } = htmlToText(await res.text());
    pages.push({ url, title, text });
    for (const l of links) {
      try {
        const u = new URL(l, url);
        if (u.origin === origin && !/\.(png|jpe?g|svg|webp|pdf|css|js|ico)$/i.test(u.pathname)) queue.push(u.origin + u.pathname);
      } catch {
        /* lien invalide */
      }
    }
  } catch (err) {
    console.warn(`Page ignorée (${url}) : ${(err as Error).message}`);
  }
}

let body = `# Contenu du site ${origin}\n\nImporté automatiquement le ${new Date().toISOString().slice(0, 10)}. Les réalisations, offres et formulations ci-dessous viennent du site : l'IA peut les citer.\n`;
for (const p of pages) {
  const chunk = `\n## ${p.title || p.url}\n(${p.url})\n\n${p.text}\n`;
  if (body.length + chunk.length > MAX_CHARS) break;
  body += chunk;
}
const out = path.join(projectRoot(), "studio", "90-site.md");
writeFileSync(out, body);
console.log(`${pages.length} page(s) importée(s) dans ${out} (${body.length} caractères). Relis le fichier avant de redéployer.`);
