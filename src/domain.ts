/** Vocabulaire métier partagé par tout le moteur. */

export type Channel = "instagram" | "bac_a_sable";

export type Source =
  | "dm"
  | "commentaire"
  | "story"
  | "mention"
  | "pub"
  | "sortant"
  | "ice_breaker"
  | "bac_a_sable";

export const STAGES = [
  "nouveau",
  "decouverte",
  "qualification",
  "qualifie",
  "ebauche",
  "rdv_propose",
  "rdv_pris",
  "gagne",
  "perdu",
  "non_qualifie",
  "a_relancer",
  "desinscrit",
] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  nouveau: "Nouveau",
  decouverte: "Découverte",
  qualification: "Qualification",
  qualifie: "Budget validé",
  ebauche: "Ébauche lancée",
  rdv_propose: "RDV proposé",
  rdv_pris: "RDV pris",
  gagne: "Signé",
  perdu: "Perdu",
  non_qualifie: "Non qualifié",
  a_relancer: "À relancer",
  desinscrit: "Désinscrit",
};

export type BudgetStatus = "inconnu" | "a_confirmer" | "ok" | "insuffisant";
export type Temperature = "froid" | "tiede" | "chaud" | "brulant";

export interface Contact {
  id: string;
  channel: Channel;
  external_id: string | null;
  username: string | null;
  name: string | null;
  profile_pic: string | null;
  follower_count: number | null;
  is_verified: boolean | null;
  follows_us: boolean | null;
  we_follow: boolean | null;
  email: string | null;
  phone: string | null;
  opted_out_at: Date | null;
  profile_fetched_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface Conversation {
  id: string;
  contact_id: string;
  channel: Channel;
  status: "ouverte" | "fermee";
  source: Source;
  source_ref: string | null;
  ai_paused_until: Date | null;
  ai_turns: number;
  relances_sent: number;
  last_inbound_at: Date | null;
  last_outbound_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export type Direction = "entrant" | "sortant";
export type Author = "prospect" | "ia" | "humain" | "systeme";
export type MessageKind = "texte" | "image" | "story_reply" | "story_mention" | "postback" | "commentaire" | "pieces";
export type MessageStatus = "recu" | "planifie" | "envoye" | "echec" | "annule";

export interface Message {
  id: string;
  conversation_id: string;
  direction: Direction;
  author: Author;
  kind: MessageKind;
  text: string | null;
  payload: Record<string, unknown>;
  external_id: string | null;
  status: MessageStatus;
  error: string | null;
  created_at: Date;
  sent_at: Date | null;
}

/** La fiche que l'IA remplit au fil de la conversation. */
export interface Fiche {
  prenom?: string;
  projet?: string;
  description?: string;
  cible?: string;
  probleme?: string;
  fonctionnalites?: string[];
  plateformes?: string;
  stade_projet?: "idee" | "maquette" | "prototype" | "app_existante" | "business_existant" | "autre";
  role?: string;
  societe_creee?: boolean;
  financement?: string[];
  montant_leve_eur?: number;
  budget_declare?: string;
  budget_estime_eur?: number;
  paiement_plusieurs_fois?: boolean;
  echeance?: string;
  decisionnaire?: boolean;
  email?: string;
  telephone?: string;
  site_web?: string;
  objections?: string[];
  signaux?: string[];
  notes?: string;
}

export interface Lead {
  contact_id: string;
  stage: Stage;
  score: number;
  temperature: Temperature;
  budget_status: BudgetStatus;
  fiche: Fiche;
  summary: string | null;
  next_action: string | null;
  manual_followup: string | null;
  ebauche_id: string | null;
  rdv_at: Date | null;
  rdv_note: string | null;
  owner: string | null;
  created_at: Date;
  updated_at: Date;
}

export type JobType =
  | "repondre"
  | "envoyer"
  | "relancer"
  | "ebauche"
  | "analyser"
  | "notifier"
  | "profil"
  | "commentaire"
  | "prospects_scan";

export interface Job {
  id: string;
  type: JobType;
  dedupe_key: string | null;
  /** File d'exécution (conversation) : ses tâches tournent une par une. */
  lane: string | null;
  payload: Record<string, unknown>;
  run_at: Date;
  status: "en_attente" | "en_cours" | "fait" | "echec" | "annule";
  attempts: number;
  last_error: string | null;
  locked_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface Ebauche {
  id: string;
  contact_id: string | null;
  conversation_id: string | null;
  status: "en_attente" | "en_cours" | "prete" | "echec";
  input: Record<string, unknown>;
  brief: EbaucheBrief | null;
  screens: { titre: string; html: string }[] | null;
  media_ids: string[] | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface EbaucheBrief {
  nom_app: string;
  promesse: string;
  cible: string;
  probleme: string;
  fonctionnalites_mvp: string[];
  parcours_principal: string[];
  ecrans: { titre: string; role: string }[];
  direction_artistique: { ambiance: string; couleurs: string[]; typographie: string };
  perimetre_21_jours: string[];
  questions_pour_l_appel: string[];
  points_de_vigilance: string[];
}

export interface Prospect {
  id: string;
  source: string;
  source_ref: string;
  company_name: string | null;
  person_name: string | null;
  siren: string | null;
  creation_date: Date | null;
  city: string | null;
  sector: string | null;
  description: string | null;
  instagram: string | null;
  website: string | null;
  linkedin: string | null;
  signals: string[];
  score: number;
  score_reason: string | null;
  opener: string | null;
  status: "a_qualifier" | "a_contacter" | "contacte" | "a_repondu" | "ecarte";
  contacted_at: Date | null;
  contact_id: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}
