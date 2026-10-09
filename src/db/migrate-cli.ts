import { existsSync } from "node:fs";
import { loadConfig } from "../config.js";
import { openDb } from "./client.js";
import { migrate } from "./migrate.js";

if (existsSync(".env")) process.loadEnvFile(".env");
const cfg = loadConfig();
const db = await openDb({ databaseUrl: cfg.DATABASE_URL, dataDir: cfg.DATA_DIR });
const applied = await migrate(db);
console.log(applied.length ? `Migrations appliquées : ${applied.join(", ")}` : "Base déjà à jour.");
await db.close();
