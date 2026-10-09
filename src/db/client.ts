import { mkdirSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { PGlite } from "@electric-sql/pglite";

/**
 * Accès SQL minimal, identique en production (Postgres) et en local / tests (PGlite,
 * un vrai Postgres embarqué, sans serveur à installer).
 */
export interface Db {
  readonly kind: "pg" | "pglite";
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  /** Plusieurs instructions SQL d'un coup (migrations). */
  exec(sql: string): Promise<void>;
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

type Queryable = { query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }> };

function wrap(kind: Db["kind"], q: Queryable, extra: Pick<Db, "exec" | "tx" | "close">): Db {
  const db: Db = {
    kind,
    async query<T>(sql: string, params: unknown[] = []) {
      const res = await q.query(sql, params);
      return res.rows as T[];
    },
    async one<T>(sql: string, params: unknown[] = []) {
      const res = await q.query(sql, params);
      return res.rows[0] as T | undefined;
    },
    ...extra,
  };
  return db;
}

export async function openPostgres(url: string): Promise<Db> {
  const pool = new pg.Pool({ connectionString: url, max: 8 });
  const self: Db = wrap("pg", pool, {
    async exec(sql) {
      await pool.query(sql);
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const inner = wrap("pg", client, {
          async exec(sql) {
            await client.query(sql);
          },
          async tx(f) {
            return f(inner);
          },
          async close() {},
        });
        const out = await fn(inner);
        await client.query("COMMIT");
        return out;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  });
  return self;
}

export async function openPglite(dataDir?: string): Promise<Db> {
  let lite: PGlite;
  if (dataDir) {
    const dir = path.resolve(dataDir, "pglite");
    mkdirSync(dir, { recursive: true });
    lite = new PGlite(dir);
  } else {
    lite = new PGlite(); // en mémoire (tests)
  }
  await lite.waitReady;
  // PGlite n'a qu'une connexion : on sérialise les transactions pour éviter les imbrications.
  let chain: Promise<unknown> = Promise.resolve();
  const self: Db = wrap("pglite", lite, {
    async exec(sql) {
      await lite.exec(sql);
    },
    async tx(fn) {
      const run = chain.then(() =>
        lite.transaction(async (t) => {
          const inner = wrap("pglite", t, {
            async exec(sql) {
              await t.exec(sql);
            },
            async tx(f) {
              return f(inner);
            },
            async close() {},
          });
          return fn(inner);
        }),
      );
      chain = run.catch(() => undefined);
      return run;
    },
    async close() {
      await lite.close();
    },
  });
  return self;
}

export async function openDb(opts: { databaseUrl?: string; dataDir?: string; memory?: boolean }): Promise<Db> {
  if (opts.databaseUrl) return openPostgres(opts.databaseUrl);
  return openPglite(opts.memory ? undefined : opts.dataDir);
}

/** Les colonnes bytea reviennent en Buffer (pg) ou Uint8Array (PGlite). */
export function toBuffer(v: unknown): Buffer {
  if (Buffer.isBuffer(v)) return v;
  if (v instanceof Uint8Array) return Buffer.from(v);
  if (typeof v === "string" && v.startsWith("\\x")) return Buffer.from(v.slice(2), "hex");
  throw new Error("Colonne binaire illisible");
}
