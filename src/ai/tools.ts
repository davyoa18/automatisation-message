import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import type { Contact, Conversation, Lead, Stage } from "../domain.js";
import type { Studio } from "../studio/knowledge.js";
import type { ToolDef } from "./llm.js";
import { updateLead } from "../db/repo/leads.js";
import { optOutContact, setContactCoordinates } from "../db/repo/contacts.js";
import { pauseAi } from "../db/repo/conversations.js";
import { createEbauche, getEbauche, logEvent } from "../db/repo/misc.js";
import { cancelJobs, enqueue } from "../db/repo/jobs.js";
import { advanceStage, computeScore, computeTemperature, deriveBudgetStatus, mergeFiche, stageFromFiche } from "./scoring.js";
import { CONSIGNES, clotureStage, ficheAdvice, lenientFiche, parseRdvDate } from "./tool-logic.js";
import { suggestSlots } from "../util/slots.js";
import { addMs, type Clock } from "../util/index.js";

export type AgentAction =
  | { type: "fiche"; champs: string[] }
  | { type: "budget"; statut: string }
  | { type: "ebauche"; ebaucheId: string }
  | { type: "rdv_propose" }
  | { type: "rdv_note"; quand: string }
  | { type: "relai_humain"; raison: string; urgence: string }
  | { type: "cloture"; motif: string }
  | { type: "desinscription"; effacer: boolean };

export interface ToolRuntime {
  db: Db;
  cfg: Config;
  studio: Studio;
  clock: Clock;
  conversation: Conversation;
  contact: Contact;
  lead: Lead;
  actions: AgentAction[];
  isSandbox: boolean;
}

/* ------------------------------ Définitions ------------------------------ */

export function agentTools(studio: Studio): ToolDef[] {
  const min = studio.vars.BUDGET_MIN;
  const call = studio.vars.DUREE_APPEL;
  return [
    {
      name: "maj_fiche",
      description:
        "Enregistre dans la fiche du prospect les informations nouvelles qu'il vient de donner : prénom, projet, cible, fonctionnalités, stade, financement, budget, échéance, coordonnées, objections. Appelle-le dès qu'une information nouvelle apparaît, avant d'écrire ta réponse. N'invente rien : les champs texte reprennent ses mots, les champs à choix peuvent se déduire de ce qu'il a dit. Renvoie la fiche à jour, le statut du budget et l'étape suivante conseillée.",
      input_schema: {
        type: "object",
        properties: {
          prenom: { type: "string" },
          projet: { type: "string", description: "Nom ou résumé très court du projet (5 à 12 mots)" },
          description: { type: "string", description: "Ce que fait l'app, en 1 à 3 phrases, avec les mots du prospect" },
          cible: { type: "string", description: "Pour qui est l'app" },
          probleme: { type: "string", description: "Le problème résolu ou l'envie derrière le projet" },
          fonctionnalites: { type: "array", items: { type: "string" }, description: "Fonctionnalités évoquées" },
          stade_projet: {
            type: "string",
            enum: ["idee", "maquette", "prototype", "app_existante", "business_existant", "autre"],
            description:
              "business_existant prime dès que la personne a déjà une activité qui génère du revenu (coach, commerce, marque…), même si l'app n'est qu'une idée. Sinon : idee (rien de concret), maquette (écrans dessinés), prototype (version testable), app_existante (app déjà publiée à refaire ou faire évoluer).",
          },
          role: { type: "string", description: "Rôle du prospect (fondateur, associé, salarié…)" },
          societe_creee: { type: "boolean" },
          financement: {
            type: "array",
            items: {
              type: "string",
              enum: ["fonds_propres", "love_money", "pret_honneur", "subvention", "levee_de_fonds", "chiffre_affaires", "pret_bancaire", "aucun", "inconnu"],
            },
          },
          montant_leve_eur: { type: "number" },
          budget_declare: { type: "string", description: "Le budget tel que le prospect l'a formulé" },
          budget_estime_eur: {
            type: "number",
            description: "Montant total en euros, seulement si le prospect a donné un chiffre ou une fourchette (prends le bas de la fourchette)",
          },
          budget_suffisant: {
            type: "string",
            enum: ["oui", "non", "incertain"],
            description: `oui : il a confirmé pouvoir investir au moins ${min} € au total, même en plusieurs fois. non : il a dit que non. incertain : c'est flou.`,
          },
          paiement_plusieurs_fois: { type: "boolean" },
          echeance: { type: "string", description: "Échéance ou date de lancement visée" },
          decisionnaire: { type: "boolean" },
          email: { type: "string" },
          telephone: { type: "string" },
          site_web: { type: "string" },
          objections: { type: "array", items: { type: "string" } },
          signaux: { type: "array", items: { type: "string" }, description: "Signaux d'achat observés (ex : « a levé 200 k€ », « salon en mars »)" },
          notes: { type: "string", description: "Une remarque utile pour l'équipe" },
        },
        additionalProperties: false,
      },
    },
    {
      name: "lancer_ebauche",
      description: `Lance la préparation de la première ébauche de l'app du prospect (promesse, parcours, premiers écrans) que l'équipe lui montrera pendant l'appel de ${call} minutes. À appeler une seule fois, quand le projet est clair (ce que fait l'app, pour qui, 2 ou 3 fonctionnalités) ET que le budget est validé. Refusé tant que le budget n'est pas validé.`,
      strict: true,
      input_schema: {
        type: "object",
        properties: {
          resume: { type: "string", description: "Le projet en 2 à 4 phrases" },
          fonctionnalites_cles: { type: "array", items: { type: "string" } },
          ambiance_visuelle: { type: "string", description: "Indices de style donnés par le prospect ou tirés de son univers ; chaîne vide si aucun" },
        },
        required: ["resume", "fonctionnalites_cles", "ambiance_visuelle"],
        additionalProperties: false,
      },
    },
    {
      name: "proposer_rdv",
      description: `Renvoie le lien de réservation de l'appel de ${call} minutes et des créneaux à proposer. Uniquement quand le budget est validé.`,
      strict: true,
      input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
    {
      name: "noter_rdv",
      description:
        "Enregistre le créneau que le prospect a choisi pour l'appel, pour que l'équipe le confirme et envoie l'invitation. Donne la date au format ISO 8601 avec le fuseau de Paris si tu peux la déduire (ex : 2026-10-14T15:30:00+02:00), sinon recopie ce que la personne a dit.",
      strict: true,
      input_schema: {
        type: "object",
        properties: {
          quand: { type: "string" },
          email: { type: "string", description: "Email pour l'invitation ; chaîne vide si inconnu" },
          remarque: { type: "string", description: "Précision utile ; chaîne vide sinon" },
        },
        required: ["quand", "email", "remarque"],
        additionalProperties: false,
      },
    },
    {
      name: "passer_la_main",
      description:
        "Met l'IA en pause sur cette conversation et alerte l'équipe pour qu'un humain réponde : demande à parler à un humain, question bloquante hors de ta base de connaissances, négociation de prix, mécontentement, sujet sensible.",
      strict: true,
      input_schema: {
        type: "object",
        properties: {
          raison: { type: "string" },
          urgence: { type: "string", enum: ["normale", "haute"] },
        },
        required: ["raison", "urgence"],
        additionalProperties: false,
      },
    },
    {
      name: "clore_conversation",
      description:
        "Classe le prospect quand il n'y a pas de suite commerciale possible maintenant : budget insuffisant, hors cible, pas intéressé, spam ou démarchage. Écris quand même un dernier message élégant.",
      strict: true,
      input_schema: {
        type: "object",
        properties: {
          motif: { type: "string", enum: ["budget_insuffisant", "hors_cible", "pas_interesse", "spam", "demarchage", "autre"] },
          recontacter: { type: "boolean", description: "true seulement si la personne a donné un horizon (une date, un mois, un événement daté) ; sinon false, et la porte ouverte se dit seulement dans le message" },
          quand: { type: "string", description: "Quand recontacter : date ISO ou mois (ex : 2027-01) ; chaîne vide si recontacter vaut false" },
        },
        required: ["motif", "recontacter", "quand"],
        additionalProperties: false,
      },
    },
    {
      name: "desinscrire",
      description:
        "À appeler quand la personne demande qu'on arrête de lui écrire, ou qu'on supprime ses données (dans ce cas effacer_donnees = true). Plus aucun message automatique ne lui sera envoyé. Remplace clore_conversation : n'appelle pas les deux.",
      strict: true,
      input_schema: {
        type: "object",
        properties: { effacer_donnees: { type: "boolean" } },
        required: ["effacer_donnees"],
        additionalProperties: false,
      },
    },
  ];
}

/* ------------------------------ Exécution ------------------------------ */

async function saveLead(rt: ToolRuntime, patch: Parameters<typeof updateLead>[2]): Promise<void> {
  rt.lead = await updateLead(rt.db, rt.contact.id, patch);
}

function rescore(rt: ToolRuntime, stage: Stage) {
  const budget = rt.lead.budget_status;
  const score = computeScore({ fiche: rt.lead.fiche, budget, stage, hasEmail: !!rt.contact.email });
  return { stage, score, temperature: computeTemperature(score, budget, stage) };
}

async function event(rt: ToolRuntime, type: string, data: Record<string, unknown> = {}) {
  await logEvent(rt.db, type, data, { contactId: rt.contact.id, conversationId: rt.conversation.id });
}

async function notifyTeam(rt: ToolRuntime, kind: string, title: string, body: string, urgent = false) {
  await enqueue(
    rt.db,
    "notifier",
    { kind, title: rt.isSandbox ? `[Bac à sable] ${title}` : title, body, urgent, contactId: rt.contact.id, conversationId: rt.conversation.id, sandbox: rt.isSandbox },
    { runAt: rt.clock.now() },
  );
}

function who(rt: ToolRuntime): string {
  const f = rt.lead.fiche;
  const handle = rt.contact.username ? `@${rt.contact.username}` : rt.contact.name ?? "un prospect";
  return f.prenom ? `${f.prenom} (${handle})` : handle;
}

export async function runTool(rt: ToolRuntime, name: string, rawInput: unknown): Promise<Record<string, unknown>> {
  const input = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<string, unknown>;
  const min = rt.studio.facts.budget_minimum_eur;
  const now = rt.clock.now();

  switch (name) {
    case "maj_fiche": {
      const patch = lenientFiche(input);
      const before = rt.lead.budget_status;
      const fiche = mergeFiche(rt.lead.fiche, patch);
      const budget = deriveBudgetStatus(fiche, patch.budget_suffisant, before, min);
      if (patch.email || patch.telephone) {
        await setContactCoordinates(rt.db, rt.contact.id, { email: patch.email, phone: patch.telephone });
        if (patch.email) rt.contact = { ...rt.contact, email: patch.email };
      }
      rt.lead = { ...rt.lead, fiche, budget_status: budget };
      const stage = advanceStage(rt.lead.stage, stageFromFiche(fiche, budget));
      await saveLead(rt, { fiche, budget_status: budget, ...rescore(rt, stage) });
      rt.actions.push({ type: "fiche", champs: Object.keys(patch) });
      if (budget !== before) {
        rt.actions.push({ type: "budget", statut: budget });
        if (budget === "ok") {
          await event(rt, "budget_valide", { budget: fiche.budget_declare ?? fiche.budget_estime_eur ?? null });
          await notifyTeam(rt, "budget_valide", `Budget validé : ${who(rt)}`, `${fiche.projet ?? "Projet en cours de description"}\nBudget : ${fiche.budget_declare ?? fiche.budget_estime_eur ?? "confirmé ≥ " + min + " €"}`);
        } else if (budget === "insuffisant") {
          await event(rt, "budget_insuffisant", { budget: fiche.budget_declare ?? fiche.budget_estime_eur ?? null });
        }
      }
      const { manquants, suite } = ficheAdvice(fiche, budget, !!rt.lead.ebauche_id);
      return { ok: true, budget, etape: rt.lead.stage, manquants, suite };
    }

    case "lancer_ebauche": {
      if (rt.lead.budget_status !== "ok") {
        return { refuse: true, raison: CONSIGNES.ebaucheRefusee(min) };
      }
      if (rt.lead.ebauche_id) {
        const existing = await getEbauche(rt.db, rt.lead.ebauche_id);
        if (existing && existing.status !== "echec") {
          return { statut: "deja_lancee", prete: existing.status === "prete", consigne: CONSIGNES.ebaucheDejaLancee };
        }
      }
      const resume = String(input.resume ?? "").slice(0, 2000);
      const fonctionnalites = Array.isArray(input.fonctionnalites_cles) ? input.fonctionnalites_cles.map(String).slice(0, 10) : [];
      const ambiance = String(input.ambiance_visuelle ?? "");
      const eb = await createEbauche(rt.db, {
        contact_id: rt.contact.id,
        conversation_id: rt.conversation.id,
        input: { resume, fonctionnalites, ambiance, fiche: rt.lead.fiche },
      });
      if (rt.cfg.EBAUCHE_ENABLED) {
        await enqueue(rt.db, "ebauche", { ebaucheId: eb.id, conversationId: rt.conversation.id }, { runAt: now, dedupeKey: `ebauche:${eb.id}` });
      }
      await saveLead(rt, { ebauche_id: eb.id, ...rescore(rt, advanceStage(rt.lead.stage, "ebauche")) });
      rt.actions.push({ type: "ebauche", ebaucheId: eb.id });
      await event(rt, "ebauche_lancee", { ebaucheId: eb.id });
      await notifyTeam(
        rt,
        "ebauche_lancee",
        `Ébauche lancée : ${who(rt)}`,
        `${resume}\nFonctionnalités : ${fonctionnalites.join(", ")}${rt.cfg.EBAUCHE_ENABLED ? "" : "\n(Génération automatique désactivée : ébauche à préparer à la main.)"}`,
      );
      return {
        statut: "en_preparation",
        consigne: CONSIGNES.ebaucheLancee(rt.studio.vars.DUREE_APPEL ?? "10"),
      };
    }

    case "proposer_rdv": {
      if (rt.lead.budget_status !== "ok") {
        return { refuse: true, raison: CONSIGNES.rdvRefuse(min) };
      }
      const creneaux = suggestSlots(now, rt.cfg.TIMEZONE);
      await saveLead(rt, rescore(rt, advanceStage(rt.lead.stage, "rdv_propose")));
      rt.actions.push({ type: "rdv_propose" });
      await event(rt, "rdv_propose", { lien: !!rt.cfg.BOOKING_URL });
      const lien = rt.cfg.BOOKING_URL || null;
      return {
        lien,
        creneaux,
        consigne: lien ? CONSIGNES.rdvAvecLien : CONSIGNES.rdvSansLien,
      };
    }

    case "noter_rdv": {
      const quand = String(input.quand ?? "").trim();
      const email = String(input.email ?? "").trim();
      const remarque = String(input.remarque ?? "").trim();
      const rdvAt = parseRdvDate(quand, now);
      if (email) {
        await setContactCoordinates(rt.db, rt.contact.id, { email });
        rt.contact = { ...rt.contact, email };
      }
      const fiche = email ? mergeFiche(rt.lead.fiche, { email }) : rt.lead.fiche;
      rt.lead = { ...rt.lead, fiche };
      await saveLead(rt, {
        fiche,
        rdv_at: rdvAt,
        rdv_note: `Demandé par le prospect : ${quand}${remarque ? ` (${remarque})` : ""} — à confirmer par l'équipe`,
        next_action: `Confirmer l'appel (${quand}) et envoyer l'invitation${email ? ` à ${email}` : ""}`,
        ...rescore(rt, advanceStage(rt.lead.stage, "rdv_pris")),
      });
      rt.actions.push({ type: "rdv_note", quand });
      await cancelJobs(rt.db, { types: ["relancer"], conversationId: rt.conversation.id });
      await event(rt, "rdv_pris", { quand, email: email || null });
      await notifyTeam(
        rt,
        "rdv_pris",
        `RDV demandé : ${who(rt)}`,
        `Créneau : ${quand}${email ? `\nEmail : ${email}` : "\nEmail : à demander"}\nProjet : ${rt.lead.fiche.projet ?? "—"}\nÀ confirmer et inviter.`,
        true,
      );
      return {
        ok: true,
        consigne: CONSIGNES.rdvNote(!!email),
      };
    }

    case "passer_la_main": {
      const raison = String(input.raison ?? "Demande d'intervention humaine");
      const urgence = input.urgence === "haute" ? "haute" : "normale";
      await pauseAi(rt.db, rt.conversation.id, addMs(now, rt.cfg.HUMAN_TAKEOVER_PAUSE_HOURS * 3_600_000));
      await saveLead(rt, { next_action: `Répondre à la main : ${raison}` });
      rt.actions.push({ type: "relai_humain", raison, urgence });
      await cancelJobs(rt.db, { types: ["relancer"], conversationId: rt.conversation.id });
      await event(rt, "relai_humain", { raison, urgence });
      await notifyTeam(rt, "relai_humain", `Un humain doit répondre : ${who(rt)}`, raison, urgence === "haute");
      return { ok: true, consigne: CONSIGNES.relaiHumain };
    }

    case "clore_conversation": {
      const motif = String(input.motif ?? "autre");
      const recontacter = input.recontacter === true;
      const quand = String(input.quand ?? "").trim();
      const stage = clotureStage(motif);
      await saveLead(rt, {
        ...rescore(rt, advanceStage(rt.lead.stage, stage)),
        next_action: recontacter ? `Recontacter ${quand || "plus tard"} (${motif})` : null,
      });
      rt.actions.push({ type: "cloture", motif });
      await cancelJobs(rt.db, { types: ["relancer"], conversationId: rt.conversation.id });
      await event(rt, "cloture", { motif, recontacter, quand: quand || null });
      return { ok: true };
    }

    case "desinscrire": {
      const effacer = input.effacer_donnees === true;
      await optOutContact(rt.db, rt.contact.id);
      rt.contact = { ...rt.contact, opted_out_at: now };
      await saveLead(rt, { ...rescore(rt, "desinscrit"), next_action: effacer ? "Effacer les données (demande du prospect)" : null });
      rt.actions.push({ type: "desinscription", effacer });
      await cancelJobs(rt.db, { types: ["relancer"], conversationId: rt.conversation.id });
      await event(rt, "desinscription", { effacer });
      if (effacer) await notifyTeam(rt, "effacement", `Demande d'effacement : ${who(rt)}`, "Le prospect demande la suppression de ses données : bouton « Effacer » dans le cockpit.", true);
      return { ok: true, consigne: CONSIGNES.desinscription };
    }

    default:
      return { erreur: CONSIGNES.outilInconnu(name) };
  }
}

/** Accepte un nom d'outil à la casse près (le modèle se trompe parfois de majuscule). */
export function resolveToolName(name: string, tools: ToolDef[]): string {
  const exact = tools.find((t) => t.name === name);
  if (exact) return exact.name;
  const ci = tools.find((t) => t.name.toLowerCase() === name.toLowerCase());
  return ci ? ci.name : name;
}
