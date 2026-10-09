import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { upsertContact } from "../src/db/repo/contacts.js";
import { getOrCreateConversation } from "../src/db/repo/conversations.js";
import { insertMessage, conversationHistory } from "../src/db/repo/messages.js";
import { enqueue, claimNext, completeJob } from "../src/db/repo/jobs.js";
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
});
