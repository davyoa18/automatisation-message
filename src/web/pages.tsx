import { raw } from "hono/html";
import type { Contact, Conversation, Ebauche, Lead, Message, Prospect } from "../domain.js";
import { STAGES, STAGE_LABELS } from "../domain.js";
import type { DashboardStats } from "../db/repo/stats.js";
import type { ConversationListItem } from "../db/repo/conversations.js";
import type { LeadListItem } from "../db/repo/leads.js";
import type { CommentRule, EventRow } from "../db/repo/misc.js";
import { SOURCE_LABELS, StagePill, Temp, ago, fmtDate, fmtDay, handle } from "./ui.js";

const EVENT_LABELS: Record<string, string> = {
  nouveau_contact: "Nouveau contact",
  budget_valide: "Budget validé",
  budget_insuffisant: "Budget insuffisant",
  ebauche_lancee: "Ébauche lancée",
  ebauche_prete: "Ébauche prête",
  rdv_propose: "Appel proposé",
  rdv_pris: "Créneau demandé",
  relai_humain: "Passage à un humain",
  reprise_humaine: "L'équipe a repris la main",
  cloture: "Conversation clôturée",
  desinscription: "Désinscription",
  relance_programmee: "Relance envoyée",
  relance_ignoree: "Relance jugée inutile",
  analyse: "Analyse mise à jour",
  note_ia: "Note de l'IA",
  fenetre_fermee: "Fenêtre de 24 h fermée",
  message_equipe: "Message de l'équipe",
  envoi_impossible: "Envoi impossible",
  prospect_a_repondu: "A répondu à l'accroche",
  commentaire_dm: "Commentaire → DM",
  signe: "Signé",
};

/* ============================== Tableau de bord ============================== */

export function DashboardPage(p: {
  stats: DashboardStats;
  hot: LeadListItem[];
  todo: LeadListItem[];
  manual: (LeadListItem & { window_open: boolean })[];
  gaps: string[];
  now: Date;
}) {
  const s = p.stats;
  const pct = (x: number) => `${Math.round(x * 100)}\u00a0%`;
  return (
    <>
      <div class="head">
        <div>
          <h1>Tableau de bord</h1>
          <p class="sub">Les 7 derniers jours sur Instagram.</p>
        </div>
        <a class="btn" href="/cockpit/bac-a-sable">Tester l'IA</a>
      </div>
      {p.gaps.length ? (
        <div class="banner">
          <strong>Pour passer en production, il manque :</strong> {p.gaps.join(" · ")}. <a href="/cockpit/reglages">Voir les réglages</a>
        </div>
      ) : null}
      <div class="kpis">
        <div class="kpi"><b>{s.conversations7j}</b><span>Conversations</span></div>
        <div class="kpi"><b>{s.qualifies7j}</b><span>Budgets validés · {pct(s.tauxQualification)}</span></div>
        <div class="kpi"><b>{s.ebauches7j}</b><span>Ébauches lancées</span></div>
        <div class="kpi"><b>{s.rdvPris7j}</b><span>Appels demandés · {pct(s.tauxRdv)}</span></div>
        <div class="kpi"><b>{s.signes30j}</b><span>Signés (30 j)</span></div>
        <div class="kpi"><b>{s.cout7jUsd.toFixed(2)} $</b><span>Coût IA · {s.cout30jUsd.toFixed(2)} $ sur 30 j</span></div>
      </div>
      <div class="grid g2">
        <section class="card">
          <h2>À traiter maintenant</h2>
          {p.todo.length ? (
            <table>
              <tbody>
                {p.todo.map((l) => (
                  <tr>
                    <td>
                      <a href={`/cockpit/conversations/${l.conversation_id}`}>{l.fiche.prenom ? `${l.fiche.prenom} · ` : ""}{handle(l)}</a>
                      <div class="small muted">{l.next_action}</div>
                    </td>
                    <td><StagePill stage={l.stage} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p class="muted">Rien d'urgent. Les créneaux demandés, les passages à un humain et les demandes d'effacement apparaissent ici.</p>
          )}
        </section>
        <section class="card">
          <h2>Leads chauds</h2>
          {p.hot.length ? (
            <table>
              <thead><tr><th>Prospect</th><th>Étape</th><th class="num">Score</th></tr></thead>
              <tbody>
                {p.hot.map((l) => (
                  <tr>
                    <td>
                      <a href={`/cockpit/conversations/${l.conversation_id}`}>{l.fiche.prenom ? `${l.fiche.prenom} · ` : ""}{handle(l)}</a>
                      <div class="small muted">{l.fiche.projet ?? "Projet à préciser"}</div>
                    </td>
                    <td><StagePill stage={l.stage} /> <Temp t={l.temperature} /></td>
                    <td class="num">{l.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p class="muted">Pas encore de lead chaud. Ils apparaissent dès qu'un budget est validé.</p>
          )}
        </section>
      </div>
      <div class="grid g2">
        <section class="card">
          <h2>À relancer à la main</h2>
          <p class="small muted">Conversations arrêtées dont la fenêtre de 24 h est fermée : seul un humain peut écrire, depuis l'application Instagram. Le message est prêt.</p>
          {p.manual.length ? (
            <div class="stack">
              {p.manual.map((l, i) => (
                <div class="card" style="padding:12px">
                  <div class="row" style="justify-content:space-between">
                    <a href={`/cockpit/conversations/${l.conversation_id}`}>{l.fiche.prenom ? `${l.fiche.prenom} · ` : ""}{handle(l)}</a>
                    {l.username ? <a class="small" href={`https://ig.me/m/${l.username}`} target="_blank" rel="noopener">Ouvrir sur Instagram</a> : null}
                  </div>
                  <p id={`mf-${i}`} style="margin:8px 0">{l.manual_followup}</p>
                  <button data-copy={`mf-${i}`}>Copier le message</button>
                </div>
              ))}
            </div>
          ) : (
            <p class="muted">Aucune relance manuelle en attente.</p>
          )}
        </section>
        <section class="card">
          <h2>Pipeline</h2>
          <table>
            <tbody>
              {[...s.pipeline].sort((a, b) => STAGES.indexOf(a.stage as never) - STAGES.indexOf(b.stage as never)).map((r) => (
                <tr>
                  <td><a href={`/cockpit/conversations?etape=${r.stage}`}><StagePill stage={r.stage} /></a></td>
                  <td class="num">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!s.pipeline.length ? <p class="muted">Le pipeline se remplit avec les premières conversations.</p> : null}
        </section>
      </div>
    </>
  );
}

/* ============================== Conversations ============================== */

export function ConversationsPage(p: { items: ConversationListItem[]; stage?: string; q?: string; now: Date }) {
  return (
    <>
      <div class="head">
        <div>
          <h1>Conversations</h1>
          <p class="sub">{p.items.length} affichée(s), les plus récentes d'abord.</p>
        </div>
        <form method="get" class="row" style="max-width:360px;flex:1">
          {p.stage ? <input type="hidden" name="etape" value={p.stage} /> : null}
          <input name="q" value={p.q ?? ""} placeholder="Rechercher un @, un prénom, un projet" />
        </form>
      </div>
      <div class="filters">
        <a href="/cockpit/conversations" class={!p.stage ? "on" : ""}>Toutes</a>
        {STAGES.map((s) => (
          <a href={`/cockpit/conversations?etape=${s}`} class={p.stage === s ? "on" : ""}>{STAGE_LABELS[s]}</a>
        ))}
      </div>
      <section class="card" style="padding:0 8px">
        <table>
          <thead><tr><th>Prospect</th><th>Dernier message</th><th>Étape</th><th class="num">Score</th><th>Activité</th></tr></thead>
          <tbody>
            {p.items.map((c) => (
              <tr>
                <td>
                  <a href={`/cockpit/conversations/${c.id}`}>{handle(c)}</a>
                  <div class="small muted">{c.channel === "bac_a_sable" ? "Bac à sable" : c.source}{c.ai_paused_until && new Date(c.ai_paused_until) > p.now ? " · IA en pause" : ""}</div>
                </td>
                <td class="small" style="max-width:420px">
                  <span class="muted">{c.last_author === "prospect" ? "" : c.last_author === "humain" ? "Équipe : " : "IA : "}</span>
                  {(c.last_text ?? "").slice(0, 140)}
                </td>
                <td><StagePill stage={c.stage} /> <Temp t={c.temperature} /></td>
                <td class="num">{c.score ?? 0}</td>
                <td class="small muted">{ago(c.last_at, p.now)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!p.items.length ? <p class="muted" style="padding:12px">Aucune conversation pour l'instant.</p> : null}
      </section>
    </>
  );
}

export function ConversationPage(p: {
  conversation: Conversation;
  contact: Contact;
  lead: Lead;
  messages: Message[];
  events: EventRow[];
  ebauche: Ebauche | null;
  windowOpen: boolean;
  windowCloses: Date | null;
  paused: boolean;
  feedback: Set<string>;
  now: Date;
  tz: string;
  humanAgentTag: boolean;
}) {
  const { contact, lead, conversation } = p;
  const f = lead.fiche;
  const fiche: [string, unknown][] = [
    ["Prénom", f.prenom],
    ["Projet", f.projet],
    ["Description", f.description],
    ["Pour qui", f.cible],
    ["Problème", f.probleme],
    ["Fonctionnalités", f.fonctionnalites?.join(", ")],
    ["Stade", f.stade_projet],
    ["Financement", f.financement?.join(", ")],
    ["Budget", f.budget_declare ?? (f.budget_estime_eur ? `${f.budget_estime_eur} €` : undefined)],
    ["Échéance", f.echeance],
    ["Email", contact.email ?? f.email],
    ["Téléphone", contact.phone ?? f.telephone],
    ["Objections", f.objections?.join(", ")],
    ["Signaux", f.signaux?.join(", ")],
    ["Notes", f.notes],
  ];
  return (
    <>
      <div class="head">
        <div>
          <h1>{f.prenom ? `${f.prenom} · ` : ""}{handle(contact)}</h1>
          <p class="sub">
            {conversation.channel === "bac_a_sable" ? "Bac à sable" : `Instagram · arrivé par ${conversation.source}`}
            {contact.follower_count != null ? ` · ${contact.follower_count} abonnés` : ""}
            {contact.opted_out_at ? " · désinscrit" : ""}
          </p>
        </div>
        <div class="row">
          <StagePill stage={lead.stage} /> <Temp t={lead.temperature} /> <span class="pill">Score {lead.score}</span>
        </div>
      </div>
      {p.paused ? <div class="banner">L'IA est en pause sur cette conversation : l'équipe a la main.</div> : null}
      <div class="convo">
        <section class="card stack">
          <div class="thread" id="thread">
            {p.messages.map((m) => {
              const out = m.direction === "sortant";
              const cls = ["msg", out ? "out" : "in", m.author === "humain" ? "human" : "", m.status === "echec" ? "failed" : "", m.status === "annule" ? "cancelled" : ""].join(" ");
              const boutons = Array.isArray(m.payload?.boutons) ? (m.payload.boutons as string[]) : [];
              return (
                <div class={cls}>
                  {m.kind !== "texte" && !out ? <div class="small muted">{m.kind === "story_reply" ? "Réponse à une story" : m.kind === "story_mention" ? "Mention en story" : m.kind === "postback" ? "Bouton" : m.kind === "commentaire" ? "Commentaire public" : "Pièce jointe"}</div> : null}
                  {m.text}
                  {boutons.length ? <div class="qr">{boutons.map((b) => <span>{b}</span>)}</div> : null}
                  <div class="meta">
                    <span>
                      {out ? (m.author === "humain" ? "Équipe" : "IA") : "Prospect"} · {fmtDate(m.created_at, p.tz)}
                      {m.status === "planifie" ? " · en cours d'envoi" : m.status === "echec" ? ` · échec : ${m.error ?? ""}` : m.status === "annule" ? " · annulé" : ""}
                    </span>
                    {out && m.author === "ia" ? (
                      p.feedback.has(m.id) ? <span>Avis noté</span> : (
                        <span>
                          <form method="post" action={`/cockpit/messages/${m.id}/avis`}><input type="hidden" name="note" value="1" /><button title="Bonne réponse">👍</button></form>
                          <form method="post" action={`/cockpit/messages/${m.id}/avis`}><input type="hidden" name="note" value="-1" /><button title="Réponse à améliorer">👎</button></form>
                        </span>
                      )
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          <form method="post" action={`/cockpit/conversations/${conversation.id}/message`} class="stack">
            <label>
              Répondre en tant qu'équipe (l'IA se met en pause)
              <textarea name="texte" required placeholder={p.windowOpen ? "Ton message…" : "Fenêtre de 24 h fermée : écris depuis l'application Instagram."}></textarea>
            </label>
            <div class="row" style="justify-content:space-between">
              <span class="small muted">
                {p.windowOpen ? `Fenêtre ouverte jusqu'au ${fmtDate(p.windowCloses, p.tz)}` : p.humanAgentTag ? "Fenêtre fermée : envoi avec le tag Human Agent (7 jours)" : "Fenêtre fermée"}
              </span>
              <button class="primary" type="submit">Envoyer</button>
            </div>
          </form>
        </section>
        <aside class="stack">
          <section class="card stack">
            <h2>Actions</h2>
            <div class="row">
              {p.paused ? (
                <form method="post" action={`/cockpit/conversations/${conversation.id}/reprendre`}><button>Rendre la main à l'IA</button></form>
              ) : (
                <form method="post" action={`/cockpit/conversations/${conversation.id}/pause`}><button>Mettre l'IA en pause</button></form>
              )}
            </div>
            <form method="post" action={`/cockpit/leads/${contact.id}/etape`} class="row">
              <select name="etape" style="flex:1">
                {STAGES.map((s) => <option value={s} selected={s === lead.stage}>{STAGE_LABELS[s]}</option>)}
              </select>
              <button type="submit">Changer l'étape</button>
            </form>
            <form method="post" action={`/cockpit/leads/${contact.id}/effacer`} onsubmit="return document.getElementById('confirm-erase').checked">
              <label class="row" style="flex-direction:row;align-items:center;color:var(--ink)"><input type="checkbox" id="confirm-erase" style="width:auto" /> Je confirme l'effacement définitif (RGPD)</label>
              <button class="danger" type="submit">Effacer toutes ses données</button>
            </form>
          </section>
          {lead.summary || lead.next_action || lead.manual_followup ? (
            <section class="card stack">
              <h2>Analyse</h2>
              {lead.summary ? <p style="margin:0">{lead.summary}</p> : null}
              {lead.next_action ? <p style="margin:0"><strong>Prochaine action :</strong> {lead.next_action}</p> : null}
              {lead.rdv_note ? <p style="margin:0"><strong>Rendez-vous :</strong> {lead.rdv_note}</p> : null}
              {lead.manual_followup ? (
                <div>
                  <p class="small muted" style="margin:0">Relance manuelle prête :</p>
                  <p id="mf" style="margin:4px 0">{lead.manual_followup}</p>
                  <button data-copy="mf">Copier</button>
                </div>
              ) : null}
            </section>
          ) : null}
          <section class="card">
            <h2>Fiche</h2>
            <dl>
              {fiche.filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => (
                <>
                  <dt>{k}</dt>
                  <dd>{String(v)}</dd>
                </>
              ))}
              <dt>Budget</dt>
              <dd>{lead.budget_status}</dd>
            </dl>
          </section>
          {p.ebauche ? (
            <section class="card stack">
              <h2>Ébauche</h2>
              <p style="margin:0">{p.ebauche.status === "prete" ? p.ebauche.brief?.promesse ?? "Prête" : p.ebauche.status === "echec" ? "Échec de génération : à préparer à la main." : "En préparation…"}</p>
              <a href={`/cockpit/ebauches/${p.ebauche.id}`}>Ouvrir l'ébauche</a>
            </section>
          ) : null}
          <section class="card">
            <h2>Historique</h2>
            <table>
              <tbody>
                {p.events.map((e) => (
                  <tr>
                    <td class="small">{EVENT_LABELS[e.type] ?? e.type}{e.type === "note_ia" ? ` : ${String(e.data.note ?? "")}` : ""}</td>
                    <td class="small muted">{ago(e.created_at, p.now)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </aside>
      </div>
      <script>{raw("const t=document.getElementById('thread');if(t)t.scrollTop=t.scrollHeight;setTimeout(()=>{if(!document.activeElement||document.activeElement.tagName!=='TEXTAREA')location.reload()},20000)")}</script>
    </>
  );
}

/* ============================== Prospects ============================== */

export function ProspectsPage(p: { prospects: Prospect[]; filter: string; counts: Record<string, number>; aiReady: boolean }) {
  const tabs: [string, string][] = [
    ["a_contacter", "À contacter"],
    ["contacte", "Contactés"],
    ["a_repondu", "Ont répondu"],
    ["a_qualifier", "À qualifier"],
    ["ecarte", "Écartés"],
  ];
  return (
    <>
      <div class="head">
        <div>
          <h1>Prospects</h1>
          <p class="sub">L'IA repère et rédige, vous envoyez le premier message vous-même depuis Instagram ou LinkedIn. Quand la personne répond, l'IA prend le relais.</p>
        </div>
        <form method="post" action="/cockpit/prospects/scan"><button>Lancer un scan maintenant</button></form>
      </div>
      <section class="card">
        <h2>Ajouter un prospect repéré</h2>
        <form method="post" action="/cockpit/prospects" class="grid g3" style="align-items:end">
          <label>Instagram<input name="instagram" placeholder="@compte" /></label>
          <label>Entreprise ou projet<input name="entreprise" /></label>
          <label>Personne<input name="personne" /></label>
          <label style="grid-column:1/-1">Ce qu'on sait (levée, lancement, offre d'emploi…)<textarea name="notes" placeholder="Ex : vient d'annoncer une levée de 300 k€ pour son app de coaching"></textarea></label>
          <div><button class="primary" type="submit">Ajouter et rédiger l'accroche</button></div>
        </form>
        {!p.aiReady ? <p class="small ko">IA non configurée : le score et l'accroche ne seront pas générés.</p> : null}
      </section>
      <div class="filters">
        {tabs.map(([k, label]) => <a href={`/cockpit/prospects?statut=${k}`} class={p.filter === k ? "on" : ""}>{label} ({p.counts[k] ?? 0})</a>)}
      </div>
      <div class="stack">
        {p.prospects.map((x, i) => (
          <section class="card stack">
            <div class="row" style="justify-content:space-between">
              <div>
                <h3>{x.company_name ?? x.person_name ?? (x.instagram ? `@${x.instagram}` : "Prospect")}</h3>
                <p class="small muted" style="margin:0">{[x.person_name, x.city, SOURCE_LABELS[x.source] ?? x.source, x.creation_date ? `créée le ${fmtDay(x.creation_date)}` : null].filter(Boolean).join(" · ")}</p>
              </div>
              <span class="pill">Score {x.score}</span>
            </div>
            {x.score_reason ? <p class="small" style="margin:0">{x.score_reason}</p> : null}
            {x.description ? <p class="small muted" style="margin:0">{x.description.slice(0, 300)}</p> : null}
            {x.opener ? (
              <div>
                <p id={`op-${i}`} style="margin:0;padding:10px;border-radius:10px;background:var(--bubble-ai)">{x.opener}</p>
                <div class="row" style="margin-top:8px">
                  <button data-copy={`op-${i}`}>Copier l'accroche</button>
                  {x.instagram ? <a class="btn" href={`https://ig.me/m/${x.instagram}`} target="_blank" rel="noopener">Ouvrir le DM</a> : (
                    <a class="btn" target="_blank" rel="noopener" href={`https://www.google.com/search?q=${encodeURIComponent(`site:instagram.com ${x.company_name ?? x.person_name ?? ""}`)}`}>Trouver son Instagram</a>
                  )}
                  {x.website ? <a class="btn" href={x.website} target="_blank" rel="noopener">Source</a> : null}
                </div>
              </div>
            ) : null}
            <form method="post" action={`/cockpit/prospects/${x.id}`} class="row">
              <input name="instagram" placeholder="@instagram" value={x.instagram ?? ""} style="max-width:220px" />
              <button name="statut" value="contacte" type="submit">J'ai envoyé le message</button>
              <button name="statut" value="ecarte" type="submit">Écarter</button>
            </form>
          </section>
        ))}
        {!p.prospects.length ? <p class="muted">Aucun prospect dans cette liste.</p> : null}
      </div>
    </>
  );
}

/* ============================== Ébauches ============================== */

export function EbauchesPage(p: { items: (Ebauche & { username: string | null; name: string | null })[] }) {
  return (
    <>
      <div class="head">
        <div>
          <h1>Ébauches</h1>
          <p class="sub">Générées automatiquement dès qu'un projet est clair et le budget validé, à montrer pendant l'appel de 10 minutes.</p>
        </div>
      </div>
      <div class="grid g3">
        {p.items.map((e) => (
          <a href={`/cockpit/ebauches/${e.id}`} class="card stack" style="color:inherit;text-decoration:none">
            {e.media_ids?.[0] ? <img class="board" src={`/media/${e.media_ids[0]}`} alt={`Ébauche ${e.brief?.nom_app ?? ""}`} loading="lazy" /> : <div class="muted small">{e.status === "echec" ? "Échec de génération" : "En préparation…"}</div>}
            <strong>{e.brief?.nom_app ?? "Projet"}</strong>
            <span class="small muted">{handle(e)} · {fmtDate(e.created_at)}</span>
          </a>
        ))}
      </div>
      {!p.items.length ? <p class="muted">Aucune ébauche pour l'instant.</p> : null}
    </>
  );
}

export function EbauchePage(p: { e: Ebauche; contact: Contact | undefined; conversationId: string | null }) {
  const b = p.e.brief;
  const media = p.e.media_ids ?? [];
  return (
    <>
      <div class="head">
        <div>
          <h1>{b?.nom_app ?? "Ébauche"}</h1>
          <p class="sub">{b?.promesse}</p>
        </div>
        {p.conversationId ? <a class="btn" href={`/cockpit/conversations/${p.conversationId}`}>Voir la conversation</a> : null}
      </div>
      {p.e.status !== "prete" ? <div class="banner">{p.e.status === "echec" ? `Échec : ${p.e.error ?? ""}` : "En préparation, rechargez dans une minute."}</div> : null}
      {media[0] ? <img class="board" src={`/media/${media[0]}`} alt="Planche des écrans" /> : null}
      {media.length > 2 ? <div class="shots">{media.slice(2).map((m) => <img src={`/media/${m}`} alt="Écran" loading="lazy" />)}</div> : null}
      {b ? (
        <div class="grid g2">
          <section class="card">
            <h2>Le projet</h2>
            <dl>
              <dt>Pour qui</dt><dd>{b.cible}</dd>
              <dt>Problème</dt><dd>{b.probleme}</dd>
              <dt>Ambiance</dt><dd>{b.direction_artistique.ambiance} · {b.direction_artistique.couleurs.join(" ")} · {b.direction_artistique.typographie}</dd>
            </dl>
            <h3 style="margin-top:12px">Fonctionnalités de la V1</h3>
            <ul>{b.fonctionnalites_mvp.map((x) => <li>{x}</li>)}</ul>
            <h3>Parcours principal</h3>
            <ol>{b.parcours_principal.map((x) => <li>{x}</li>)}</ol>
          </section>
          <section class="card">
            <h2>Pour l'appel</h2>
            <h3>Questions à poser</h3>
            <ul>{b.questions_pour_l_appel.map((x) => <li>{x}</li>)}</ul>
            <h3>Livré en 21 jours</h3>
            <ul>{b.perimetre_21_jours.map((x) => <li>{x}</li>)}</ul>
            <h3>Points de vigilance</h3>
            <ul>{b.points_de_vigilance.map((x) => <li>{x}</li>)}</ul>
          </section>
        </div>
      ) : null}
    </>
  );
}

/* ============================== Bac à sable ============================== */

const SANDBOX_JS = `
const sid = document.body.dataset.sid;
const thread = document.getElementById('sb-thread'); const fiche = document.getElementById('sb-fiche'); const typing = document.getElementById('sb-typing');
const form = document.getElementById('sb-form'); const input = document.getElementById('sb-input');
async function refresh(){ try{ const r = await fetch('/cockpit/bac-a-sable/'+sid+'/etat',{headers:{accept:'application/json'}}); if(!r.ok) return; const s = await r.json();
  thread.innerHTML=''; for(const m of s.messages){ const d=document.createElement('div'); d.className='msg '+(m.direction==='entrant'?'in':'out'); d.textContent=m.text; if(m.boutons&&m.boutons.length){const q=document.createElement('div');q.className='qr';for(const b of m.boutons){const sp=document.createElement('span');sp.textContent=b;sp.style.cursor='pointer';sp.onclick=()=>{input.value=b;form.requestSubmit()};q.appendChild(sp)}d.appendChild(q)} thread.appendChild(d) }
  typing.hidden = !s.typing; thread.scrollTop = thread.scrollHeight;
  fiche.textContent = JSON.stringify(s.lead, null, 2); }catch(e){} }
form.addEventListener('submit', async (e)=>{ e.preventDefault(); const text=input.value.trim(); if(!text) return; input.value=''; await fetch('/cockpit/bac-a-sable/'+sid+'/message',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text})}); refresh(); });
document.querySelectorAll('[data-persona]').forEach(b=>b.addEventListener('click',()=>{input.value=b.dataset.persona;input.focus()}));
refresh(); setInterval(refresh, 1500);
`;

export function SandboxPage(p: { sid: string; aiReady: boolean }) {
  const personas: [string, string][] = [
    ["Fondatrice financée", "Hello ! On vient de lever 200k pour notre app de covoiturage entre parents d'élèves, vous pouvez nous aider ?"],
    ["Coach avec audience", "Salut, je suis coach sportive (25k abonnés) et je veux lancer mon app de programmes"],
    ["Porteur sans budget", "Yo j'ai une idée d'app de fou mais je suis étudiant, c'est gratuit pour commencer ?"],
    ["Pressé du prix", "Combien coûte une app chez vous ?"],
    ["Démarcheur", "Bonjour, nous proposons des campagnes d'acquisition pour les studios, dispo pour un call ?"],
  ];
  return (
    <>
      <div class="head">
        <div>
          <h1>Bac à sable</h1>
          <p class="sub">Parlez à l'IA comme un prospect. Mêmes prompts, mêmes outils, même fiche qu'en production ; rien ne part sur Instagram.</p>
        </div>
        <a class="btn" href="/cockpit/bac-a-sable?nouveau=1">Nouvelle conversation</a>
      </div>
      {!p.aiReady ? <div class="banner">Ajoutez ANTHROPIC_API_KEY pour que l'IA réponde.</div> : null}
      <div class="row">{personas.map(([label, text]) => <button data-persona={text}>{label}</button>)}</div>
      <div class="convo">
        <section class="card stack">
          <div class="thread" id="sb-thread" style="min-height:50vh"></div>
          <p id="sb-typing" class="small muted" hidden>L'IA écrit…</p>
          <form id="sb-form" class="row">
            <input id="sb-input" placeholder="Écris comme un prospect…" autocomplete="off" style="flex:1" />
            <button class="primary" type="submit">Envoyer</button>
          </form>
        </section>
        <aside class="card">
          <h2>Fiche en direct</h2>
          <pre id="sb-fiche" class="mono" style="white-space:pre-wrap;margin:0"></pre>
        </aside>
      </div>
      <script>{raw(`document.body.dataset.sid=${JSON.stringify(p.sid)};${SANDBOX_JS}`)}</script>
    </>
  );
}

/* ============================== Réglages ============================== */

export function SettingsPage(p: {
  gaps: string[];
  rows: [string, string][];
  rules: CommentRule[];
  usage: { purpose: string; model: string; calls: number; cost_usd: number }[];
  webhookUrl: string;
}) {
  return (
    <>
      <div class="head">
        <div>
          <h1>Réglages</h1>
          <p class="sub">La configuration se fait par variables d'environnement (voir docs/). Cette page montre l'état réel.</p>
        </div>
      </div>
      <div class="grid g2">
        <section class="card">
          <h2>Mise en production</h2>
          {p.gaps.length ? <ul>{p.gaps.map((g) => <li class="ko">{g}</li>)}</ul> : <p class="ok">Tout est configuré.</p>}
          <p class="small muted">URL de webhook à déclarer chez Meta : <span class="mono">{p.webhookUrl}</span></p>
        </section>
        <section class="card">
          <h2>Configuration</h2>
          <dl>{p.rows.map(([k, v]) => <><dt>{k}</dt><dd>{v}</dd></>)}</dl>
        </section>
      </div>
      <section class="card stack">
        <h2>Commentaire → message privé</h2>
        <p class="small muted">Quand quelqu'un commente un de ces mots-clés, l'IA lui écrit en privé (un message par commentaire, sous 7 jours) et répond publiquement sous le commentaire.</p>
        <table>
          <thead><tr><th>Mots-clés</th><th>Publication</th><th>Message privé</th><th></th></tr></thead>
          <tbody>
            {p.rules.map((r) => (
              <tr>
                <td>{r.keywords.join(", ")}</td>
                <td class="small">{r.media_id ?? "Toutes"}</td>
                <td class="small">{r.dm_text ?? "Message par défaut (présentation IA + question sur le projet)"}</td>
                <td><form method="post" action={`/cockpit/regles/${r.id}/supprimer`}><button class="danger">Supprimer</button></form></td>
              </tr>
            ))}
          </tbody>
        </table>
        <form method="post" action="/cockpit/regles" class="grid g3" style="align-items:end">
          <label>Mots-clés (séparés par des virgules)<input name="mots" placeholder="APP, MAQUETTE" required /></label>
          <label>ID de publication (vide = toutes)<input name="media" /></label>
          <label>Réponse publique (vide = variée automatiquement)<input name="public" /></label>
          <label style="grid-column:1/-1">Message privé (vide = message par défaut)<textarea name="dm"></textarea></label>
          <div><button class="primary" type="submit">Ajouter la règle</button></div>
        </form>
      </section>
      <section class="card">
        <h2>Coûts IA sur 30 jours</h2>
        <table>
          <thead><tr><th>Usage</th><th>Modèle</th><th class="num">Appels</th><th class="num">Coût</th></tr></thead>
          <tbody>{p.usage.map((u) => <tr><td>{u.purpose}</td><td class="mono">{u.model}</td><td class="num">{u.calls}</td><td class="num">{u.cost_usd.toFixed(3)} $</td></tr>)}</tbody>
        </table>
      </section>
    </>
  );
}

export function LoginPage(p: { error?: string; retour?: string; studio: string }) {
  return (
    <html lang="fr">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Connexion · Moteur DM</title>
        <style>{raw(`body{font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f5f6f8;color:#14171c}@media (prefers-color-scheme:dark){body{background:#0e1116;color:#e6e9ee}form{background:#161a21!important;border-color:#262c36!important}input{background:#0e1116;color:#e6e9ee;border-color:#262c36}}form{background:#fff;border:1px solid #e2e5ea;border-radius:14px;padding:28px;display:flex;flex-direction:column;gap:12px;width:min(360px,90vw)}input{font:inherit;padding:10px;border-radius:8px;border:1px solid #e2e5ea}button{font:inherit;padding:10px;border-radius:8px;border:0;background:#0f766e;color:#fff;font-weight:600;cursor:pointer}.err{color:#d93a3a;margin:0}`)}</style>
      </head>
      <body>
        <form method="post" action="/cockpit/connexion">
          <h1 style="margin:0;font-size:20px">Moteur DM · {p.studio}</h1>
          {p.error ? <p class="err">{p.error}</p> : null}
          <input type="hidden" name="retour" value={p.retour ?? "/cockpit"} />
          <input type="password" name="motdepasse" placeholder="Mot de passe de l'équipe" required autofocus />
          <button type="submit">Se connecter</button>
        </form>
      </body>
    </html>
  );
}
