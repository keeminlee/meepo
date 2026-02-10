import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

let dbSingleton: Database.Database | null = null;

function ensureDirFor(dbPath: string) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function getDb(): Database.Database {
  if (dbSingleton) return dbSingleton;

  const dbPath = process.env.DB_PATH || "./data/bot.sqlite";
  ensureDirFor(dbPath);

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  // apply schema
  const schemaPath = path.join(process.cwd(), "src", "db", "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");
  db.exec(schema);

  // Apply migrations
  applyMigrations(db);

  dbSingleton = db;
  return dbSingleton;
}

function applyMigrations(db: Database.Database) {
  // Migration: Add form_id to npc_instances (Day 7)
  const columns = db.pragma("table_info(npc_instances)");
  const hasFormId = columns.some((col: any) => col.name === "form_id");
  
  if (!hasFormId) {
    console.log("Migrating: Adding form_id to npc_instances");
    db.exec("ALTER TABLE npc_instances ADD COLUMN form_id TEXT NOT NULL DEFAULT 'meepo'");
  }

// (Future migrations can go here)
}
