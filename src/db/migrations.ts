/**
 * Migrations SQL, appliquées dans l'ordre au démarrage. Ne jamais modifier une migration
 * déjà déployée : en ajouter une nouvelle.
 */
export const MIGRATIONS: { id: string; sql: string }[] = [
  {
    id: "001_init",
    sql: /* sql */ `
CREATE TABLE contacts (
  id text PRIMARY KEY,
  channel text NOT NULL DEFAULT 'instagram',
  external_id text,
  username text,
  name text,
  profile_pic text,
  follower_count integer,
  is_verified boolean,
  follows_us boolean,
  we_follow boolean,
  email text,
  phone text,
  opted_out_at timestamptz,
  profile_fetched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, external_id)
);
CREATE INDEX contacts_username ON contacts (lower(username));

CREATE TABLE conversations (
  id text PRIMARY KEY,
  contact_id text NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel text NOT NULL DEFAULT 'instagram',
  status text NOT NULL DEFAULT 'ouverte',
  source text NOT NULL DEFAULT 'dm',
  source_ref text,
  ai_paused_until timestamptz,
  ai_turns integer NOT NULL DEFAULT 0,
  relances_sent integer NOT NULL DEFAULT 0,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversations_contact ON conversations (contact_id);
CREATE INDEX conversations_activity ON conversations (last_inbound_at DESC NULLS LAST);

CREATE TABLE messages (
  id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction text NOT NULL,
  author text NOT NULL,
  kind text NOT NULL DEFAULT 'texte',
  text text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  external_id text,
  status text NOT NULL DEFAULT 'recu',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE UNIQUE INDEX messages_external ON messages (external_id) WHERE external_id IS NOT NULL;
CREATE INDEX messages_conversation ON messages (conversation_id, created_at);

CREATE TABLE leads (
  contact_id text PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
  stage text NOT NULL DEFAULT 'nouveau',
  score integer NOT NULL DEFAULT 0,
  temperature text NOT NULL DEFAULT 'froid',
  budget_status text NOT NULL DEFAULT 'inconnu',
  fiche jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text,
  next_action text,
  manual_followup text,
  ebauche_id text,
  rdv_at timestamptz,
  rdv_note text,
  owner text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX leads_stage ON leads (stage);
CREATE INDEX leads_score ON leads (score DESC);

CREATE TABLE jobs (
  id text PRIMARY KEY,
  type text NOT NULL,
  dedupe_key text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  run_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'en_attente',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX jobs_dedupe_active ON jobs (dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('en_attente', 'en_cours');
CREATE INDEX jobs_due ON jobs (status, run_at);

CREATE TABLE ebauches (
  id text PRIMARY KEY,
  contact_id text REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id text,
  status text NOT NULL DEFAULT 'en_attente',
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  brief jsonb,
  screens jsonb,
  media_ids jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ebauches_contact ON ebauches (contact_id);

CREATE TABLE media (
  id text PRIMARY KEY,
  content_type text NOT NULL,
  bytes bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE prospects (
  id text PRIMARY KEY,
  source text NOT NULL,
  source_ref text NOT NULL,
  company_name text,
  person_name text,
  siren text,
  creation_date date,
  city text,
  sector text,
  description text,
  instagram text,
  website text,
  linkedin text,
  signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  score integer NOT NULL DEFAULT 0,
  score_reason text,
  opener text,
  status text NOT NULL DEFAULT 'a_qualifier',
  contacted_at timestamptz,
  contact_id text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_ref)
);
CREATE INDEX prospects_status ON prospects (status, score DESC);
CREATE INDEX prospects_instagram ON prospects (lower(instagram));

CREATE TABLE events (
  id bigserial PRIMARY KEY,
  contact_id text,
  conversation_id text,
  type text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_contact ON events (contact_id, created_at DESC);
CREATE INDEX events_type ON events (type, created_at DESC);

CREATE TABLE llm_usage (
  id bigserial PRIMARY KEY,
  purpose text NOT NULL,
  model text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cache_read_tokens integer NOT NULL DEFAULT 0,
  cache_write_tokens integer NOT NULL DEFAULT 0,
  cost_usd double precision NOT NULL DEFAULT 0,
  conversation_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX llm_usage_created ON llm_usage (created_at);

CREATE TABLE feedback (
  id bigserial PRIMARY KEY,
  message_id text,
  conversation_id text,
  rating integer NOT NULL,
  comment text,
  author text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE comment_rules (
  id text PRIMARY KEY,
  media_id text,
  keywords text[] NOT NULL,
  dm_text text,
  public_reply text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE comment_replies (
  comment_id text PRIMARY KEY,
  rule_id text,
  media_id text,
  from_id text,
  from_username text,
  text text,
  dm_sent boolean NOT NULL DEFAULT false,
  public_replied boolean NOT NULL DEFAULT false,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
`,
  },
];
