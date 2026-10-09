import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { upsertContact } from "../src/db/repo/contacts.js";
import { getOrCreateConversation } from "../src/db/repo/conversations.js";
import { insertMessage, conversationHistory } from "../src/db/repo/messages.js";
import { enqueue, claimNext, completeJob, failJob, heartbeatJobs, releaseJobs, requeueStale } from "../src/db/repo/jobs.js";
import { getLead, updateLead } from "../src/db/repo/leads.js";
import { storeMedia, getMedia } from "../src/db/repo/misc.js";

let db: Db;
beforeAll(async () => {
  db = await openDb({ memory: true });
  await migrate(db);
});
afterAll(async () => db.close());

describe("base de données", () => {
  it("crée contact, conversation et messages sans doublon de webhook", async () => {
    const { contact, created } = await upsertContact(db, "instagram", "IGSID-1", { username: "lea.app" });
    expect(created).toBe(true);
    const again = await upsertContact(db, "instagram", "IGSID-1");
    expect(again.created).toBe(false);
    const { conversation } = await getOrCreateConversation(db, contact.id, "instagram", "dm");
    const m1 = await insertMessage(db, { conversation_id: conversation.id, direction: "entrant", author: "prospect", text: "Salut", external_id: "mid.1" });
    const dup = await insertMessage(db, { conversation_id: conversation.id, direction: "entrant", author: "prospect", text: "Salut", external_id: "mid.1" });
    expect(m1).toBeDefined();
    expect(dup).toBeUndefined();
    const hist = await conversationHistory(db, conversation.id);
    expect(hist).toHaveLength(1);
  });

  it("dédoublonne et reprogramme les tâches", async () => {
    const t0 = new Date("2026-10-10T10:00:00Z");
    const a = await enqueue(db, "repondre", { conversationId: "c1" }, { runAt: t0, dedupeKey: "repondre:c1", replace: true });
    const b = await enqueue(db, "repondre", { conversationId: "c1" }, { runAt: new Date(t0.getTime() + 5000), dedupeKey: "repondre:c1", replace: true });
    expect(b.id).toBe(a.id);
    expect(new Date(b.run_at).getTime()).toBe(t0.getTime() + 5000);
    expect(await claimNext(db, t0)).toBeUndefined();
    const job = await claimNext(db, new Date(t0.getTime() + 6000));
    expect(job?.id).toBe(a.id);
    await completeJob(db, a.id);
  });

  it("met à jour la fiche du lead", async () => {
    const { contact } = await upsertContact(db, "instagram", "IGSID-2");
    const lead = await getLead(db, contact.id);
    expect(lead.stage).toBe("nouveau");
    const up = await updateLead(db, contact.id, { stage: "qualifie", fiche: { prenom: "Léa", fonctionnalites: ["chat"] }, score: 72 });
    expect(up.fiche.prenom).toBe("Léa");
    expect(up.score).toBe(72);
  });

  it("stocke et relit un média binaire", async () => {
    const id = await storeMedia(db, "image/png", Buffer.from([1, 2, 3]));
    const m = await getMedia(db, id);
    expect(m?.bytes.equals(Buffer.from([1, 2, 3]))).toBe(true);
  });

  it("garde une réponse en attente pendant qu'une autre tourne, sans jamais les exécuter ensemble", async () => {
    const t0 = new Date("2026-10-11T10:00:00Z");
    await enqueue(db, "repondre", { conversationId: "q1" }, { runAt: t0, dedupeKey: "repondre:q1", replace: true });
    const running = (await claimNext(db, t0))!;
    expect(running.lane).toBe("conv:q1");
    // Un message arrive pendant la réponse : une seconde tâche attend, avec la même clé.
    const next = await enqueue(db, "repondre", { conversationId: "q1" }, { runAt: t0, dedupeKey: "repondre:q1", replace: true });
    expect(next.id).not.toBe(running.id);
    expect(next.dedupe_key).toBe("repondre:q1");
    // Un troisième message reprogramme la même tâche en attente, sans en créer d'autre.
    const again = await enqueue(db, "repondre", { conversationId: "q1" }, { runAt: new Date(t0.getTime() + 8000), dedupeKey: "repondre:q1", replace: true });
    expect(again.id).toBe(next.id);
    // Tant que la première tourne, la suivante n'est pas réservée.
    expect(await claimNext(db, new Date(t0.getTime() + 60_000))).toBeUndefined();
    await completeJob(db, running.id);
    expect((await claimNext(db, new Date(t0.getTime() + 60_000)))?.id).toBe(next.id);
  });

  it("ne fait jamais tourner deux tâches de la même conversation en même temps", async () => {
    const t0 = new Date("2026-10-11T11:00:00Z");
    await enqueue(db, "envoyer", { conversationId: "q2", messageIds: ["a"] }, { runAt: t0, dedupeKey: "envoyer:a" });
    await enqueue(db, "relancer", { conversationId: "q2", numero: 1 }, { runAt: t0 });
    await enqueue(db, "repondre", { conversationId: "q3" }, { runAt: t0, dedupeKey: "repondre:q3" });
    const first = (await claimNext(db, t0))!;
    const second = (await claimNext(db, t0))!;
    expect([first.lane, second.lane].sort()).toEqual(["conv:q2", "conv:q3"]);
    expect(await claimNext(db, t0)).toBeUndefined();
    await completeJob(db, first.lane === "conv:q2" ? first.id : second.id);
    expect((await claimNext(db, t0))?.lane).toBe("conv:q2");
  });

  it("annule un échec retenté quand une tâche identique attend déjà", async () => {
    const t0 = new Date("2026-10-11T12:00:00Z");
    await enqueue(db, "analyser", { conversationId: "q4" }, { runAt: t0, dedupeKey: "analyser:q4", replace: true });
    const running = (await claimNext(db, t0))!;
    const waiting = await enqueue(db, "analyser", { conversationId: "q4" }, { runAt: t0, dedupeKey: "analyser:q4", replace: true });
    await failJob(db, running.id, "boom", new Date(t0.getTime() + 30_000));
    const rows = await db.query<{ id: string; status: string }>("SELECT id, status FROM jobs WHERE dedupe_key = 'analyser:q4' ORDER BY created_at");
    expect(rows).toEqual([
      { id: running.id, status: "annule" },
      { id: waiting.id, status: "en_attente" },
    ]);
  });

  it("reprend les tâches sans signe de vie et rend celles d'un worker qui s'arrête", async () => {
    const t0 = new Date("2026-10-11T13:00:00Z");
    await enqueue(db, "notifier", { kind: "a" }, { runAt: t0, dedupeKey: "n:a" });
    await enqueue(db, "notifier", { kind: "b" }, { runAt: t0, dedupeKey: "n:b" });
    const a = (await claimNext(db, t0))!;
    const b = (await claimNext(db, t0))!;
    await heartbeatJobs(db, [a.id], new Date(t0.getTime() + 5 * 60_000));
    // b n'a pas donné signe de vie depuis plus de 3 minutes : il est repris ; a reste en cours.
    // (les tâches laissées « en cours » par les tests précédents sont reprises aussi)
    expect(await requeueStale(db, new Date(t0.getTime() + 2 * 60_000))).toBeGreaterThanOrEqual(1);
    const status = async (id: string) => (await db.one<{ status: string; attempts: number }>("SELECT status, attempts FROM jobs WHERE id = $1", [id]))!;
    expect((await status(b.id)).status).toBe("en_attente");
    expect((await status(a.id)).status).toBe("en_cours");
    expect(await releaseJobs(db, [a.id])).toBe(1);
    expect(await status(a.id)).toEqual({ status: "en_attente", attempts: 0 });
  });

  it("garde une seule conversation ouverte et un seul « nouveau contact » en cas de messages simultanés", async () => {
    const [x, y] = await Promise.all([upsertContact(db, "instagram", "IGSID-RACE"), upsertContact(db, "instagram", "IGSID-RACE")]);
    expect([x.created, y.created].filter(Boolean)).toHaveLength(1);
    const [c1, c2] = await Promise.all([getOrCreateConversation(db, x.contact.id, "instagram", "dm"), getOrCreateConversation(db, x.contact.id, "instagram", "dm")]);
    expect(c1.conversation.id).toBe(c2.conversation.id);
    expect([c1.created, c2.created].filter(Boolean)).toHaveLength(1);
  });
});
