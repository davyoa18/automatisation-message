import type { Db } from "../client.js";

export interface DashboardStats {
  conversations7j: number;
  nouveauxContacts7j: number;
  messagesEntrants7j: number;
  qualifies7j: number;
  ebauches7j: number;
  rdvProposes7j: number;
  rdvPris7j: number;
  signes30j: number;
  pipeline: { stage: string; count: number }[];
  cout7jUsd: number;
  cout30jUsd: number;
  tauxQualification: number;
  tauxRdv: number;
}

export async function dashboardStats(db: Db, now: Date): Promise<DashboardStats> {
  const d7 = new Date(now.getTime() - 7 * 86_400_000);
  const d30 = new Date(now.getTime() - 30 * 86_400_000);
  const n = async (sql: string, params: unknown[]) => Number((await db.one<{ n: number }>(sql, params))?.n ?? 0);

  const [conversations7j, nouveauxContacts7j, messagesEntrants7j] = await Promise.all([
    n("SELECT count(*)::int AS n FROM conversations WHERE last_inbound_at >= $1 AND channel = 'instagram'", [d7]),
    n("SELECT count(*)::int AS n FROM contacts WHERE created_at >= $1 AND channel = 'instagram'", [d7]),
    n(
      "SELECT count(*)::int AS n FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.direction = 'entrant' AND m.created_at >= $1 AND c.channel = 'instagram'",
      [d7],
    ),
  ]);
  const evt = (type: string, since: Date) =>
    n(
      "SELECT count(DISTINCT e.contact_id)::int AS n FROM events e JOIN contacts c ON c.id = e.contact_id WHERE e.type = $1 AND e.created_at >= $2 AND c.channel = 'instagram'",
      [type, since],
    );
  const [qualifies7j, ebauches7j, rdvProposes7j, rdvPris7j, signes30j] = await Promise.all([
    evt("budget_valide", d7),
    evt("ebauche_lancee", d7),
    evt("rdv_propose", d7),
    evt("rdv_pris", d7),
    evt("signe", d30),
  ]);
  const pipeline = await db.query<{ stage: string; count: number }>(
    `SELECT l.stage, count(*)::int AS count FROM leads l JOIN contacts c ON c.id = l.contact_id
      WHERE c.channel = 'instagram' GROUP BY l.stage ORDER BY count DESC`,
  );
  const cost = async (since: Date) =>
    Number((await db.one<{ c: number }>("SELECT coalesce(sum(cost_usd), 0)::float AS c FROM llm_usage WHERE created_at >= $1", [since]))?.c ?? 0);
  const [cout7jUsd, cout30jUsd] = await Promise.all([cost(d7), cost(d30)]);
  return {
    conversations7j,
    nouveauxContacts7j,
    messagesEntrants7j,
    qualifies7j,
    ebauches7j,
    rdvProposes7j,
    rdvPris7j,
    signes30j,
    pipeline,
    cout7jUsd,
    cout30jUsd,
    tauxQualification: conversations7j ? qualifies7j / conversations7j : 0,
    tauxRdv: qualifies7j ? rdvPris7j / qualifies7j : 0,
  };
}
