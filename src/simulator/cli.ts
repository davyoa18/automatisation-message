/**
 * Discuter avec l'IA dans le terminal, comme un prospect sur Instagram (bac à sable : rien ne part
 * sur Instagram). Nécessite ANTHROPIC_API_KEY.
 *
 *   npm run simulate
 *   npm run simulate -- --source commentaire     (simule une arrivée par commentaire)
 */
import { existsSync } from "node:fs";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { loadConfig } from "../config.js";
import { openDb } from "../db/client.js";
import { createApp } from "../app.js";
import { setLogLevel } from "../logger.js";
import { findContactByExternal } from "../db/repo/contacts.js";
import { latestConversationForContact } from "../db/repo/conversations.js";
import { conversationHistory } from "../db/repo/messages.js";
import { getLead } from "../db/repo/leads.js";
import { newId, sleep } from "../util/index.js";
import type { Source } from "../domain.js";

if (existsSync(".env")) process.loadEnvFile(".env");
const cfg = loadConfig();
setLogLevel("warn");
if (!cfg.ANTHROPIC_API_KEY) {
  console.error("Ajoute ANTHROPIC_API_KEY dans .env pour discuter avec l'IA.");
  process.exit(1);
}
const sourceArg = process.argv.indexOf("--source");
const source = (sourceArg > 0 ? process.argv[sourceArg + 1] : "bac_a_sable") as Source;

const db = await openDb({ memory: true });
const app = await createApp({ ...cfg, PACING_PROFILE: "rapide", REPLY_DEBOUNCE_SECONDS: 0 }, { db, renderer: null });
const sid = `terminal-${newId()}`;
const rl = readline.createInterface({ input: stdin, output: stdout });

console.log(`\n${app.studio.vars.ASSISTANT_NAME} (${cfg.AI_MODEL_CONVERSATION}) — écris comme un prospect. « /fiche » pour voir la fiche, « /quitter » pour sortir.\n`);
let shown = 0;
for (;;) {
  const text = (await rl.question("toi > ")).trim();
  if (!text) continue;
  if (text === "/quitter") break;
  const contact = await findContactByExternal(db, "bac_a_sable", sid);
  if (text === "/fiche") {
    if (contact) console.log(JSON.stringify(await getLead(db, contact.id), null, 2));
    continue;
  }
  await app.engine.onInbound({ channel: "bac_a_sable", externalUserId: sid, mid: null, text, kind: "texte", payload: {}, source: contact ? "bac_a_sable" : source, at: new Date(), username: "prospect.test" });
  const t0 = Date.now();
  stdout.write(`${app.studio.vars.ASSISTANT_NAME} écrit…\r`);
  while (Date.now() - t0 < 180_000) {
    await app.worker.drain(10);
    const c = await findContactByExternal(db, "bac_a_sable", sid);
    const conv = c ? await latestConversationForContact(db, c.id) : undefined;
    const pending = conv
      ? await db.one<{ n: number }>("SELECT count(*)::int AS n FROM jobs WHERE status IN ('en_attente','en_cours') AND type IN ('repondre','envoyer') AND payload->>'conversationId' = $1", [conv.id])
      : { n: 0 };
    if (!pending?.n) break;
    await sleep(300);
  }
  const c = await findContactByExternal(db, "bac_a_sable", sid);
  const conv = c ? await latestConversationForContact(db, c.id) : undefined;
  if (!c || !conv) continue;
  const out = (await conversationHistory(db, conv.id, 500)).filter((m) => m.direction === "sortant" && m.status === "envoye");
  for (const m of out.slice(shown)) {
    console.log(`${app.studio.vars.ASSISTANT_NAME} > ${m.text}`);
    const boutons = Array.isArray(m.payload?.boutons) ? (m.payload.boutons as string[]) : [];
    if (boutons.length) console.log(`         [${boutons.join("] [")}]`);
  }
  shown = out.length;
  const lead = await getLead(db, c.id);
  console.log(`  · étape ${lead.stage} · budget ${lead.budget_status} · score ${lead.score}\n`);
}
rl.close();
await app.close();
