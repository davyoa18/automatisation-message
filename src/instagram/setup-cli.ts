/**
 * Configure le compte Instagram une fois l'app Meta créée :
 *   - vérifie le jeton et le compte ;
 *   - abonne l'app aux webhooks (messages, boutons, commentaires…) ;
 *   - installe les questions d'accueil (ice breakers).
 *
 *   npm run ig:setup            (tout)
 *   npm run ig:setup -- --check (vérification seule)
 */
import { existsSync } from "node:fs";
import { loadConfig } from "../config.js";
import { GraphMessenger } from "./client.js";

if (existsSync(".env")) process.loadEnvFile(".env");
const cfg = loadConfig();
if (!cfg.IG_ACCOUNT_ID || !cfg.IG_ACCESS_TOKEN) {
  console.error("Renseigne IG_ACCOUNT_ID et IG_ACCESS_TOKEN dans .env (voir docs/02-connexion-instagram.md).");
  process.exit(1);
}
const ig = new GraphMessenger({ accountId: cfg.IG_ACCOUNT_ID, accessToken: cfg.IG_ACCESS_TOKEN, version: cfg.IG_GRAPH_VERSION, host: cfg.IG_API_HOST });
const checkOnly = process.argv.includes("--check");

const step = async (label: string, fn: () => Promise<unknown>) => {
  try {
    const out = await fn();
    console.log(`✓ ${label}`, out ? JSON.stringify(out) : "");
    return true;
  } catch (err) {
    console.log(`✗ ${label} : ${(err as Error).message}`);
    return false;
  }
};

await step("Compte Instagram", () => ig.me());
if (!checkOnly) {
  await step("Abonnement aux webhooks", () =>
    ig.subscribeWebhooks(["messages", "messaging_postbacks", "messaging_seen", "messaging_referral", "message_reactions", "comments"]),
  );
  await step("Questions d'accueil (ice breakers)", () =>
    ig.setIceBreakers([
      { question: "J'ai une idée d'app 💡", payload: "ICE:IDEE" },
      { question: "Combien coûte une app ?", payload: "ICE:PRIX" },
      { question: "En combien de temps ?", payload: "ICE:DELAI" },
      { question: "Parler à l'équipe", payload: "ICE:EQUIPE" },
    ]),
  );
}
console.log(`\nURL de webhook à déclarer dans l'app Meta : ${cfg.PUBLIC_BASE_URL}/webhooks/instagram`);
console.log("Jeton de vérification : la valeur de IG_VERIFY_TOKEN dans votre .env.");
