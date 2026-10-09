/**
 * Démo locale du cockpit avec des données FICTIVES en mémoire (rien n'est écrit sur disque,
 * rien ne part sur Instagram). Lancer : npm run demo, puis ouvrir http://localhost:3999/cockpit
 */
import { serve } from "@hono/node-server";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db/client.js";
import { createApp } from "../src/app.js";
import { createServer } from "../src/web/server.js";
import { ScriptedLlm, fake } from "../src/ai/llm.js";
import { RecordingMessenger } from "../src/instagram/client.js";
import { MemoryNotifier } from "../src/notify/index.js";
import { PlaywrightRenderer } from "../src/ebauche/render.js";
import { upsertContact, updateContactProfile } from "../src/db/repo/contacts.js";
import { getOrCreateConversation, touchInbound, touchOutbound } from "../src/db/repo/conversations.js";
import { insertMessage } from "../src/db/repo/messages.js";
import { updateLead } from "../src/db/repo/leads.js";
import { createEbauche, insertProspect, logEvent, recordUsage, storeMedia, updateEbauche, updateProspect, upsertCommentRule } from "../src/db/repo/misc.js";
import type { EbaucheBrief, Fiche, Stage, Temperature, BudgetStatus } from "../src/domain.js";

const port = Number(process.env.PORT ?? 3999);
const cfg = loadConfig({ NODE_ENV: "development", PORT: String(port), PUBLIC_BASE_URL: `http://localhost:${port}`, BOOKING_URL: "https://cal.com/yd-studio/decouverte", ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { PLAYWRIGHT_CHROMIUM_PATH: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}) } as NodeJS.ProcessEnv);
const db = await openDb({ memory: true });
const demoBrain = new ScriptedLlm(() => [fake.json({ messages: ["(Démo) Ajoutez ANTHROPIC_API_KEY pour parler à la vraie IA."], boutons: [], relance_utile: false, note_equipe: "" })]);
const app = await createApp(cfg, { db, llm: process.env.ANTHROPIC_API_KEY ? undefined : demoBrain, messenger: new RecordingMessenger("dry_run"), notifier: new MemoryNotifier() });
const now = Date.now();
const H = 3_600_000;

async function convo(o: {
  igsid: string;
  username: string;
  name: string;
  followers: number;
  source: "dm" | "commentaire" | "story" | "pub" | "sortant";
  stage: Stage;
  score: number;
  temperature: Temperature;
  budget: BudgetStatus;
  fiche: Fiche;
  summary?: string;
  next?: string;
  manual?: string;
  rdv?: string;
  msgs: [("p" | "ia" | "eq"), string, number][];
  events?: [string, number][];
}) {
  const { contact } = await upsertContact(db, "instagram", o.igsid, { username: o.username, name: o.name });
  await updateContactProfile(db, contact.id, { follower_count: o.followers, follows_us: true });
  const { conversation } = await getOrCreateConversation(db, contact.id, "instagram", o.source);
  for (const [who, text, hAgo] of o.msgs) {
    const at = new Date(now - hAgo * H);
    await insertMessage(db, {
      conversation_id: conversation.id,
      direction: who === "p" ? "entrant" : "sortant",
      author: who === "p" ? "prospect" : who === "ia" ? "ia" : "humain",
      text,
      status: who === "p" ? "recu" : "envoye",
      created_at: at,
      sent_at: who === "p" ? null : at,
    });
    if (who === "p") await touchInbound(db, conversation.id, at);
    else await touchOutbound(db, conversation.id, at);
  }
  await updateLead(db, contact.id, { stage: o.stage, score: o.score, temperature: o.temperature, budget_status: o.budget, fiche: o.fiche, summary: o.summary ?? null, next_action: o.next ?? null, manual_followup: o.manual ?? null, rdv_note: o.rdv ?? null });
  for (const [type, hAgo] of o.events ?? []) {
    await db.query("INSERT INTO events (contact_id, conversation_id, type, data, created_at) VALUES ($1, $2, $3, '{}'::jsonb, $4)", [contact.id, conversation.id, type, new Date(now - hAgo * H)]);
  }
  return { contact, conversation };
}

const sarah = await convo({
  igsid: "demo-1", username: "sarah.maternite", name: "Sarah Benali", followers: 3200, source: "commentaire", stage: "rdv_pris", score: 93, temperature: "brulant", budget: "ok",
  fiche: { prenom: "Sarah", projet: "App de suivi de grossesse avec sages-femmes", description: "Suivi semaine par semaine et téléconsultation avec des sages-femmes", cible: "futures mamans", fonctionnalites: ["suivi semaine par semaine", "prise de rendez-vous", "messagerie sage-femme"], financement: ["levee_de_fonds"], budget_declare: "8 à 10 k€", budget_estime_eur: 8000, echeance: "lancement en janvier", email: "sarah@exemple.fr" },
  summary: "Sarah lance une app de suivi de grossesse avec téléconsultation. Pré-seed de 150 k€ levé, budget app 8-10 k€. Créneau demandé mercredi 14 h 30.",
  next: "Confirmer l'appel (mercredi 14 h 30) et envoyer l'invitation à sarah@exemple.fr", rdv: "Demandé : mercredi 14 h 30 — à confirmer",
  msgs: [["p", "app", 3], ["ia", "Hello @sarah.maternite ! Merci pour ton commentaire 🙌 Moi c'est Nova, l'IA de YD Studio. Tu as un projet d'app en tête ?", 2.99], ["p", "Oui ! Une app de suivi de grossesse avec des sages-femmes en téléconsultation", 2.9], ["ia", "Le suivi de grossesse avec un vrai lien humain, c'est fort. Tes futures utilisatrices, elles en sont où aujourd'hui : appli générique, groupes Facebook ?", 2.89], ["p", "Exactement, des apps génériques et des forums. Nous on veut du suivi semaine par semaine, la prise de RDV et une messagerie avec la sage-femme", 2.8], ["ia", "Pour te situer : nos apps iOS natives démarrent à 5 000 €, payables en plusieurs fois, avec une première version livrée en 21 jours. C'est compatible avec ton budget ?", 2.79], ["p", "Oui pas de souci, on vient de lever 150k en pré-seed, on a prévu 8 à 10k pour l'app", 2.7], ["ia", "Top. L'équipe lance une première ébauche de ton app : la promesse, le parcours principal et les premiers écrans.", 2.69], ["ia", "On te la montre en 10 min en visio ? Réserve ici : https://cal.com/yd-studio/decouverte, ou dis-moi ce qui t'arrange.", 2.68], ["p", "Mercredi 14h30 c'est parfait ! mon mail c'est sarah@exemple.fr", 2.5], ["ia", "C'est noté pour mercredi 14 h 30 ✨ L'équipe t'envoie l'invitation par email.", 2.49]],
  events: [["nouveau_contact", 3], ["budget_valide", 2.7], ["ebauche_lancee", 2.69], ["rdv_propose", 2.68], ["rdv_pris", 2.5]],
});
await convo({
  igsid: "demo-2", username: "karim.btp", name: "Karim A.", followers: 870, source: "pub", stage: "rdv_propose", score: 71, temperature: "brulant", budget: "ok",
  fiche: { prenom: "Karim", projet: "Marketplace de matériel de BTP entre artisans", fonctionnalites: ["annonces", "réservation", "paiement sécurisé"], financement: ["chiffre_affaires"], budget_declare: "9 000 €", budget_estime_eur: 9000, stade_projet: "business_existant" },
  summary: "Artisan avec une entreprise qui tourne, veut une marketplace de location de matériel entre artisans. Budget 9 k€. Appel proposé, pas encore réservé.",
  next: "Attendre la réservation ; relancer demain si rien", msgs: [["p", "Bonjour, je vois votre pub, vous faites des marketplaces ?", 20], ["ia", "Bonjour Karim ! Moi c'est Nova, l'IA de YD Studio. Oui, on conçoit des apps iOS de A à Z. Votre marketplace mettrait en relation qui avec qui ?", 19.9], ["p", "Des artisans qui louent du matériel entre eux. J'ai déjà une entreprise de maçonnerie, j'ai 9000€ pour ça", 19.5], ["ia", "Parfait. L'équipe lance une première ébauche de votre marketplace. On vous la montre en 10 min en visio cette semaine ?", 19.4]],
  events: [["nouveau_contact", 20], ["budget_valide", 19.5], ["ebauche_lancee", 19.4], ["rdv_propose", 19.4]],
});
await convo({
  igsid: "demo-3", username: "ines.covoit", name: "Inès", followers: 1500, source: "story", stage: "qualification", score: 34, temperature: "tiede", budget: "a_confirmer",
  fiche: { prenom: "Inès", projet: "Covoiturage entre étudiants à Lyon", fonctionnalites: ["profils vérifiés", "chat", "paiement intégré"], signaux: ["300 inscrits sur liste d'attente"] },
  summary: "Étudiante-entrepreneure, projet de covoiturage étudiant, 300 inscrits en liste d'attente. Budget pas encore clair.",
  manual: "Hello Inès ! Ici l'équipe YD Studio. Ta liste d'attente de 300 étudiants nous a marqués 👀 Tu as pu avancer sur le financement (prêt d'honneur, bourse) ? On peut te montrer à quoi ressemblerait ton app en 10 min.",
  msgs: [["p", "J'adore votre story sur l'app de colocation ! Moi c'est pour du covoiturage étudiant", 30], ["ia", "Merci Inès ! Moi c'est Nova, l'IA de YD Studio. Un covoiturage pensé pour les étudiants, malin. Qu'est-ce qui manque aux apps existantes pour eux ?", 29.9], ["p", "Les prix et la confiance. Profils vérifiés avec la carte étudiante, un chat et le paiement intégré. J'ai déjà 300 inscrits", 29.5], ["ia", "300 inscrits avant même l'app, c'est un super signal. Pour te situer : nos apps démarrent à 5 000 €, payables en plusieurs fois. C'est envisageable de ton côté ?", 29.4], ["p", "Je sais pas encore, je dois voir avec la BPI", 29]],
  events: [["nouveau_contact", 30]],
});
await convo({
  igsid: "demo-4", username: "hugo.antigaspi", name: "Hugo", followers: 140, source: "dm", stage: "non_qualifie", score: 9, temperature: "froid", budget: "insuffisant",
  fiche: { prenom: "Hugo", projet: "App de recettes anti-gaspi", budget_declare: "1 500 € max", budget_estime_eur: 1500 },
  msgs: [["p", "Salut, combien pour une app de recettes anti-gaspi ?", 6], ["ia", "Salut Hugo ! Moi c'est Nova, l'IA de YD Studio. Nos apps iOS natives démarrent à 5 000 €, payables en plusieurs fois. C'est dans ton budget ?", 5.9], ["p", "Ah… moi je pensais plutôt 1500€ max, je suis étudiant", 5.8], ["ia", "Merci pour ta franchise. À ce budget, on ne pourra pas t'accompagner pour l'instant. Pour avancer, teste ton idée avec une page d'attente et une maquette Figma : si ça prend, un prêt d'honneur peut financer la V1. Reviens nous voir à ce moment-là 🙌", 5.79]],
  events: [["nouveau_contact", 6], ["budget_insuffisant", 5.8], ["cloture", 5.79]],
});
await convo({
  igsid: "demo-5", username: "lea.ink", name: "Léa Martin", followers: 12400, source: "dm", stage: "decouverte", score: 12, temperature: "tiede", budget: "inconnu",
  fiche: { prenom: "Léa", projet: "Réservation pour salons de tatouage" },
  msgs: [["p", "Coucou ! Je tiens un salon de tatouage et je rêve d'une app de réservation pour mes clients", 0.3], ["ia", "Coucou Léa ! Moi c'est Nova, l'IA de YD Studio. Un salon qui veut sa propre app, j'adore. Aujourd'hui tes clients réservent comment ?", 0.29]],
  events: [["nouveau_contact", 0.3]],
});

// Ébauche rendue pour Sarah (écrans HTML écrits à la main pour la démo).
const brief: EbaucheBrief = {
  nom_app: "Douce Attente", promesse: "Votre grossesse, suivie semaine après semaine par une vraie sage-femme.", cible: "Futures mamans qui veulent un suivi humain", probleme: "Les apps génériques n'offrent ni lien humain ni suivi personnalisé",
  fonctionnalites_mvp: ["Suivi semaine par semaine", "Prise de rendez-vous", "Messagerie avec la sage-femme", "Rappels personnalisés"],
  parcours_principal: ["Je crée mon profil et ma date de terme", "Je découvre ma semaine", "Je pose une question à ma sage-femme", "Je réserve une téléconsultation"],
  ecrans: [{ titre: "Ma semaine", role: "Accueil" }, { titre: "Ma sage-femme", role: "Messagerie" }, { titre: "Rendez-vous", role: "Réservation" }],
  direction_artistique: { ambiance: "Douce, rassurante et premium", couleurs: ["#F4E9E4", "#C9787C", "#2E2A33"], typographie: "SF Pro Rounded" },
  perimetre_21_jours: ["Profil et terme", "Contenu des 40 semaines", "Messagerie", "Réservation avec paiement"], questions_pour_l_appel: ["Combien de sages-femmes au lancement ?", "Paiement à l'acte ou abonnement ?"], points_de_vigilance: ["Données de santé : hébergement HDS à prévoir"],
};
const screens = [
  { titre: "Ma semaine", html: `<style>.e1-w{position:absolute;inset:0;background:linear-gradient(180deg,#F4E9E4,#fff 60%);font-family:-apple-system,"SF Pro Rounded","Helvetica Neue",sans-serif;color:#2E2A33;padding:64px 22px 0}.e1-h{font-size:34px;font-weight:800;letter-spacing:-.02em;margin:8px 0 2px}.e1-s{color:#8a7f86;font-size:15px}.e1-c{margin-top:22px;background:#fff;border-radius:28px;padding:22px;box-shadow:0 12px 30px rgba(201,120,124,.18)}.e1-big{font-size:64px;font-weight:800;color:#C9787C;line-height:1}.e1-r{display:flex;gap:10px;margin-top:16px}.e1-t{flex:1;background:#F4E9E4;border-radius:18px;padding:12px;font-size:13px}.e1-t b{display:block;font-size:17px}.e1-cta{margin-top:20px;background:#2E2A33;color:#fff;border-radius:18px;padding:16px;text-align:center;font-weight:700}.e1-tab{position:absolute;bottom:0;left:0;right:0;height:84px;background:#fff;border-top:1px solid #eee;display:flex;justify-content:space-around;padding-top:12px;font-size:11px;color:#8a7f86}.e1-tab .on{color:#C9787C;font-weight:700}</style><div class="e1-w"><div class="e1-s">Bonjour Sarah</div><div class="e1-h">Semaine 24</div><div class="e1-s">Bébé a la taille d'un épi de maïs 🌽</div><div class="e1-c"><div class="e1-big">24</div><div style="margin-top:6px;font-weight:600">semaines · 2e trimestre</div><div class="e1-r"><div class="e1-t"><b>30 cm</b>taille</div><div class="e1-t"><b>600 g</b>poids</div><div class="e1-t"><b>16</b>semaines restantes</div></div></div><div class="e1-cta">Poser une question à Claire, ma sage-femme</div></div><div class="e1-tab"><span class="on">Ma semaine</span><span>Messages</span><span>Rendez-vous</span><span>Profil</span></div>` },
  { titre: "Ma sage-femme", html: `<style>.e2-w{position:absolute;inset:0;background:#fff;font-family:-apple-system,"Helvetica Neue",sans-serif;color:#2E2A33;padding:62px 18px 0}.e2-top{display:flex;align-items:center;gap:12px;padding-bottom:14px;border-bottom:1px solid #f0e6e2}.e2-av{width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#C9787C,#F4E9E4)}.e2-n{font-weight:700}.e2-st{font-size:12px;color:#4caf7a}.e2-b{max-width:78%;padding:12px 14px;border-radius:20px;margin-top:12px;font-size:15px;line-height:1.35}.e2-in{background:#F4E9E4;border-bottom-left-radius:6px}.e2-out{background:#C9787C;color:#fff;margin-left:auto;border-bottom-right-radius:6px}.e2-inp{position:absolute;bottom:40px;left:16px;right:16px;background:#F4E9E4;border-radius:22px;padding:14px 18px;color:#8a7f86;font-size:15px}</style><div class="e2-w"><div class="e2-top"><div class="e2-av"></div><div><div class="e2-n">Claire, sage-femme</div><div class="e2-st">● Répond en général en 1 h</div></div></div><div class="e2-b e2-in">Bonjour Sarah ! Comment vous sentez-vous cette semaine ?</div><div class="e2-b e2-out">J'ai des contractions légères le soir, c'est normal ?</div><div class="e2-b e2-in">À 24 semaines, de légères contractions irrégulières peuvent arriver. Si elles deviennent régulières, on en parle en téléconsultation.</div><div class="e2-inp">Écrire à Claire…</div></div>` },
  { titre: "Rendez-vous", html: `<style>.e3-w{position:absolute;inset:0;background:#2E2A33;font-family:-apple-system,"Helvetica Neue",sans-serif;color:#fff;padding:64px 22px 0}.e3-h{font-size:30px;font-weight:800;margin:0 0 18px}.e3-d{display:flex;gap:8px}.e3-day{flex:1;border-radius:16px;background:rgba(255,255,255,.08);padding:10px 0;text-align:center;font-size:12px}.e3-day b{display:block;font-size:20px}.e3-day.on{background:#C9787C}.e3-sl{margin-top:22px;display:grid;grid-template-columns:1fr 1fr;gap:10px}.e3-x{border:1px solid rgba(255,255,255,.2);border-radius:14px;padding:14px;text-align:center;font-weight:600}.e3-x.on{background:#fff;color:#2E2A33}.e3-cta{position:absolute;left:22px;right:22px;bottom:48px;background:#C9787C;border-radius:18px;padding:17px;text-align:center;font-weight:800}</style><div class="e3-w"><div class="e3-h">Téléconsultation</div><div class="e3-d"><div class="e3-day">lun<b>13</b></div><div class="e3-day on">mar<b>14</b></div><div class="e3-day">mer<b>15</b></div><div class="e3-day">jeu<b>16</b></div></div><div class="e3-sl"><div class="e3-x">09:30</div><div class="e3-x on">11:00</div><div class="e3-x">14:30</div><div class="e3-x">17:00</div></div><div class="e3-cta">Réserver · 25 €</div></div>` },
];
const eb = await createEbauche(db, { contact_id: sarah.contact.id, conversation_id: sarah.conversation.id, input: {} });
await updateEbauche(db, eb.id, { brief, screens });
try {
  const renderer = new PlaywrightRenderer(cfg.PLAYWRIGHT_CHROMIUM_PATH);
  const out = await renderer.render(screens, brief, "YD Studio");
  const ids = [await storeMedia(db, "image/png", out.board), await storeMedia(db, "image/jpeg", out.teaser), ...(await Promise.all(out.screens.map((s) => storeMedia(db, "image/png", s))))];
  await updateEbauche(db, eb.id, { status: "prete", media_ids: ids });
  await renderer.close();
} catch (err) {
  console.warn("Rendu des maquettes indisponible :", (err as Error).message);
  await updateEbauche(db, eb.id, { status: "prete" });
}
await updateLead(db, sarah.contact.id, { ebauche_id: eb.id });
await logEvent(db, "ebauche_prete", { ebaucheId: eb.id }, { contactId: sarah.contact.id, conversationId: sarah.conversation.id });

const p1 = await insertProspect(db, { source: "actualite", source_ref: "https://exemple.fr/levee-1", company_name: "Kidmove", description: "Kidmove lève 400 k€ pour son app de covoiturage entre parents d'élèves", signals: ["levee_de_fonds"] });
if (p1) await updateProspect(db, p1.id, { score: 86, score_reason: "Levée récente et produit centré sur une app mobile grand public.", status: "a_contacter", opener: "Bravo pour la levée de Kidmove 🎉 Le covoiturage entre parents, ça se joue à la confiance et à la simplicité sur mobile. Vous avez déjà une app native en route, ou c'est le prochain chantier ?" });
const p2 = await insertProspect(db, { source: "registre", source_ref: "912345678", company_name: "FITLOOP SAS", person_name: "Mehdi K.", city: "Bordeaux", creation_date: "2026-08-20", description: "Société créée le 2026-08-20 à Bordeaux. Recherche : « application mobile ».", signals: ["societe_recente"] });
if (p2) await updateProspect(db, p2.id, { score: 58, score_reason: "Société très récente dont le nom évoque une app de fitness ; budget inconnu.", status: "a_contacter", opener: "Hello Mehdi, j'ai vu la création de Fitloop à Bordeaux, félicitations ! Vous partez sur une app de suivi d'entraînement ? Curieux de savoir où vous en êtes." });
await upsertCommentRule(db, { keywords: ["APP", "MAQUETTE"] });
for (const [purpose, model, cost] of [["conversation", "claude-sonnet-5-5", 0.84], ["analyse", "claude-haiku-5-5", 0.01], ["ebauche_ecrans", "claude-opus-5-5", 0.31], ["ebauche_brief", "claude-opus-5-5", 0.06]] as const) {
  await recordUsage(db, { purpose, model, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: cost });
}

const web = createServer(app, { workerRunning: true });
app.worker.start();
serve({ fetch: web.fetch, port }, () => console.log(`Démo prête : http://localhost:${port}/cockpit (données fictives, en mémoire)`));
