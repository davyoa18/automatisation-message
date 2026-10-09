import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import type { EbaucheBrief } from "../domain.js";
import type { Studio } from "../studio/knowledge.js";
import { type Llm, parseJsonLoose, textOf } from "../ai/llm.js";
import { getEbauche, storeMedia, updateEbauche } from "../db/repo/misc.js";
import type { Renderer } from "./render.js";
import { log } from "../logger.js";
import { parseBrief, parseScreens } from "./screens.js";
import { errorMessage } from "../util/index.js";

export const BRIEF_SCHEMA = {
  type: "object",
  properties: {
    nom_app: { type: "string" },
    promesse: { type: "string" },
    cible: { type: "string" },
    probleme: { type: "string" },
    fonctionnalites_mvp: { type: "array", items: { type: "string" } },
    parcours_principal: { type: "array", items: { type: "string" } },
    ecrans: {
      type: "array",
      items: {
        type: "object",
        properties: { titre: { type: "string" }, role: { type: "string" } },
        required: ["titre", "role"],
        additionalProperties: false,
      },
    },
    direction_artistique: {
      type: "object",
      properties: {
        ambiance: { type: "string" },
        couleurs: { type: "array", items: { type: "string" } },
        typographie: { type: "string" },
      },
      required: ["ambiance", "couleurs", "typographie"],
      additionalProperties: false,
    },
    perimetre_21_jours: { type: "array", items: { type: "string" } },
    questions_pour_l_appel: { type: "array", items: { type: "string" } },
    points_de_vigilance: { type: "array", items: { type: "string" } },
  },
  required: [
    "nom_app",
    "promesse",
    "cible",
    "probleme",
    "fonctionnalites_mvp",
    "parcours_principal",
    "ecrans",
    "direction_artistique",
    "perimetre_21_jours",
    "questions_pour_l_appel",
    "points_de_vigilance",
  ],
  additionalProperties: false,
};

const SCREENS_SCHEMA = {
  type: "object",
  properties: {
    ecrans: {
      type: "array",
      items: {
        type: "object",
        properties: { titre: { type: "string" }, html: { type: "string" } },
        required: ["titre", "html"],
        additionalProperties: false,
      },
    },
  },
  required: ["ecrans"],
  additionalProperties: false,
};

export { sanitizeScreenHtml } from "./screens.js";

export interface EbaucheDeps {
  db: Db;
  llm: Llm;
  cfg: Config;
  studio: Studio;
  renderer: Renderer | null;
}

export async function generateBrief(deps: Pick<EbaucheDeps, "llm" | "cfg" | "studio">, input: Record<string, unknown>, conversationId?: string | null): Promise<EbaucheBrief> {
  const res = await deps.llm.create({
    purpose: "ebauche_brief",
    model: deps.cfg.AI_MODEL_EBAUCHE,
    system: deps.studio.prompt("ebauche-brief"),
    messages: [{ role: "user", content: `Voici ce que l'on sait du projet du prospect :\n\n${JSON.stringify(input, null, 2)}` }],
    outputSchema: BRIEF_SCHEMA,
    effort: "medium",
    maxTokens: 8000,
    conversationId,
  });
  const brief = parseBrief(parseJsonLoose(textOf(res.content)));
  if (!brief) throw new Error("Brief d'ébauche incomplet");
  return brief;
}

export async function generateScreens(
  deps: Pick<EbaucheDeps, "llm" | "cfg" | "studio">,
  brief: EbaucheBrief,
  conversationId?: string | null,
): Promise<{ titre: string; html: string }[]> {
  const res = await deps.llm.create({
    purpose: "ebauche_ecrans",
    model: deps.cfg.AI_MODEL_EBAUCHE,
    system: deps.studio.prompt("ebauche-ecrans"),
    messages: [{ role: "user", content: `Brief de l'app :\n\n${JSON.stringify(brief, null, 2)}` }],
    outputSchema: SCREENS_SCHEMA,
    effort: "high",
    maxTokens: 48000,
    conversationId,
  });
  const screens = parseScreens(parseJsonLoose(textOf(res.content)));
  if (!screens.length) throw new Error("Aucun écran exploitable dans la réponse");
  return screens;
}

/** Génère l'ébauche complète : brief, écrans HTML, images. Idempotent sur un échec partiel. */
export async function buildEbauche(deps: EbaucheDeps, ebaucheId: string): Promise<{ ok: boolean; mediaIds: string[] }> {
  const eb = await getEbauche(deps.db, ebaucheId);
  if (!eb) throw new Error(`Ébauche introuvable : ${ebaucheId}`);
  if (eb.status === "prete") return { ok: true, mediaIds: eb.media_ids ?? [] };
  await updateEbauche(deps.db, ebaucheId, { status: "en_cours", error: null });
  try {
    const brief = eb.brief ?? (await generateBrief(deps, eb.input, eb.conversation_id));
    await updateEbauche(deps.db, ebaucheId, { brief });
    const screens = eb.screens?.length ? eb.screens : await generateScreens(deps, brief, eb.conversation_id);
    await updateEbauche(deps.db, ebaucheId, { screens });
    const mediaIds: string[] = [];
    if (deps.renderer) {
      const out = await deps.renderer.render(screens, brief, deps.studio.vars.STUDIO_NAME!);
      mediaIds.push(await storeMedia(deps.db, "image/png", out.board));
      mediaIds.push(await storeMedia(deps.db, "image/jpeg", out.teaser));
      for (const s of out.screens) mediaIds.push(await storeMedia(deps.db, "image/png", s));
    }
    await updateEbauche(deps.db, ebaucheId, { status: "prete", media_ids: mediaIds });
    return { ok: true, mediaIds };
  } catch (err) {
    log.error("génération d'ébauche en échec", { ebaucheId, error: err });
    await updateEbauche(deps.db, ebaucheId, { status: "echec", error: errorMessage(err) });
    return { ok: false, mediaIds: [] };
  }
}
