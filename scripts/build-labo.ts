/**
 * Construit le Labo Nova : une seule page HTML autonome (prompts de production, outils et
 * interface), à publier comme artifact Claude. Usage : npm run labo:build [-- chemin/sortie.html]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { loadConfig } from "../src/config.js";
import { loadStudio, projectRoot } from "../src/studio/knowledge.js";
import { buildLaboData } from "../labo/data.js";

export async function buildLabo(opts: { out?: string; env?: NodeJS.ProcessEnv } = {}): Promise<{ file: string; html: string }> {
  const root = projectRoot();
  const cfg = loadConfig(opts.env ?? process.env);
  const data = buildLaboData(cfg, loadStudio(cfg));
  const bundle = await build({
    entryPoints: [path.join(root, "labo/app.ts")],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["es2022"],
    minify: true,
    write: false,
    legalComments: "none",
    charset: "utf8",
  });
  const js = bundle.outputFiles[0]!.text.replace(/<\/script/gi, "<\\/script");
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const template = readFileSync(path.join(root, "labo/template.html"), "utf8");
  // Remplacements par fonction : le code contient des « $ » qu'un remplacement par chaîne interpréterait.
  const html = template
    .replace("<!-- LABO:DATA -->", () => `<script>window.__LABO_DATA__=${json};</script>`)
    .replace("<!-- LABO:SCRIPT -->", () => `<script>${js}</script>`);
  const file = opts.out ?? path.join(root, "labo/dist/labo-nova.html");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, html);
  return { file, html };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const out = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
  const { file, html } = await buildLabo({ out });
  console.log(`Labo construit : ${file} (${Math.round(Buffer.byteLength(html) / 1024)} ko)`);
}
