import type { Db } from "../client.js";
import type { Channel, Contact } from "../../domain.js";
import { newId } from "../../util/index.js";

export async function findContact(db: Db, id: string): Promise<Contact | undefined> {
  return db.one<Contact>("SELECT * FROM contacts WHERE id = $1", [id]);
}

export async function findContactByExternal(db: Db, channel: Channel, externalId: string): Promise<Contact | undefined> {
  return db.one<Contact>("SELECT * FROM contacts WHERE channel = $1 AND external_id = $2", [channel, externalId]);
}

export async function findContactByUsername(db: Db, username: string): Promise<Contact | undefined> {
  const u = username.replace(/^@/, "").toLowerCase();
  return db.one<Contact>("SELECT * FROM contacts WHERE lower(username) = $1 ORDER BY created_at LIMIT 1", [u]);
}

/** Crée le contact au premier message, sinon le renvoie. */
export async function upsertContact(
  db: Db,
  channel: Channel,
  externalId: string,
  init: Partial<Pick<Contact, "username" | "name">> = {},
): Promise<{ contact: Contact; created: boolean }> {
  const existing = await findContactByExternal(db, channel, externalId);
  if (existing) {
    if ((init.username && !existing.username) || (init.name && !existing.name)) {
      const updated = await db.one<Contact>(
        "UPDATE contacts SET username = COALESCE(username, $2), name = COALESCE(name, $3), updated_at = now() WHERE id = $1 RETURNING *",
        [existing.id, init.username ?? null, init.name ?? null],
      );
      return { contact: updated ?? existing, created: false };
    }
    return { contact: existing, created: false };
  }
  const row = await db.one<Contact & { inserted: boolean }>(
    `INSERT INTO contacts (id, channel, external_id, username, name)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (channel, external_id) DO UPDATE SET updated_at = now()
     RETURNING *, (xmax = 0) AS inserted`,
    [newId(), channel, externalId, init.username ?? null, init.name ?? null],
  );
  if (!row) throw new Error("Création du contact impossible");
  // Deux webhooks simultanés : un seul des deux crée vraiment le contact.
  const { inserted, ...contact } = row;
  return { contact: contact as Contact, created: inserted === true };
}

export async function updateContactProfile(
  db: Db,
  id: string,
  p: Partial<
    Pick<Contact, "username" | "name" | "profile_pic" | "follower_count" | "is_verified" | "follows_us" | "we_follow">
  >,
): Promise<void> {
  await db.query(
    `UPDATE contacts SET
       username = COALESCE($2, username),
       name = COALESCE($3, name),
       profile_pic = COALESCE($4, profile_pic),
       follower_count = COALESCE($5, follower_count),
       is_verified = COALESCE($6, is_verified),
       follows_us = COALESCE($7, follows_us),
       we_follow = COALESCE($8, we_follow),
       profile_fetched_at = now(),
       updated_at = now()
     WHERE id = $1`,
    [
      id,
      p.username ?? null,
      p.name ?? null,
      p.profile_pic ?? null,
      p.follower_count ?? null,
      p.is_verified ?? null,
      p.follows_us ?? null,
      p.we_follow ?? null,
    ],
  );
}

export async function setContactCoordinates(db: Db, id: string, c: { email?: string; phone?: string }): Promise<void> {
  await db.query(
    "UPDATE contacts SET email = COALESCE($2, email), phone = COALESCE($3, phone), updated_at = now() WHERE id = $1",
    [id, c.email ?? null, c.phone ?? null],
  );
}

export async function optOutContact(db: Db, id: string): Promise<void> {
  await db.query("UPDATE contacts SET opted_out_at = COALESCE(opted_out_at, now()), updated_at = now() WHERE id = $1", [id]);
}

/** Droit à l'effacement (RGPD) : supprime le contact et tout ce qui en dépend. */
export async function eraseContact(db: Db, id: string): Promise<void> {
  await db.tx(async (t) => {
    await t.query("DELETE FROM events WHERE contact_id = $1", [id]);
    await t.query(
      "DELETE FROM media WHERE id IN (SELECT jsonb_array_elements_text(media_ids) FROM ebauches WHERE contact_id = $1 AND media_ids IS NOT NULL)",
      [id],
    );
    await t.query("UPDATE prospects SET contact_id = NULL WHERE contact_id = $1", [id]);
    await t.query("DELETE FROM contacts WHERE id = $1", [id]);
  });
}
