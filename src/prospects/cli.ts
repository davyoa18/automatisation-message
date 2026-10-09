/** Lance un scan de prospects tout de suite (sinon il tourne chaque jour à PROSPECTS_SCAN_AT). */
import { existsSync } from "node:fs";
import { loadConfig } from "../config.js";
import { createApp } from "../app.js";
import { listProspects } from "../db/repo/misc.js";

if (existsSync(".env")) process.loadEnvFile(".env");
const app = await createApp(loadConfig(), { renderer: null });
const res = await app.prospects.scan();
console.log(`Ajoutés : ${res.added} · évalués : ${res.scored} · accroches : ${res.openers}`);
if (res.errors.length) console.log(`Sources en erreur : ${res.errors.join(" ; ")}`);
for (const p of await listProspects(app.db, { status: ["a_contacter"], limit: 10 })) {
  console.log(`\n[${p.score}] ${p.company_name ?? p.person_name ?? p.instagram} — ${p.score_reason ?? ""}\n  ${p.opener ?? ""}`);
}
await app.close();
