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
  const npcColumns = db.pragma("table_info(npc_instances)") as any[];
  const hasFormId = npcColumns.some((col: any) => col.name === "form_id");
  
  if (!hasFormId) {
    console.log("Migrating: Adding form_id to npc_instances");
    db.exec("ALTER TABLE npc_instances ADD COLUMN form_id TEXT NOT NULL DEFAULT 'meepo'");
  }

  // Migration: Add voice/narrative fields to ledger_entries (Day 8 - Phase 0)
  const ledgerColumns = db.pragma("table_info(ledger_entries)") as any[];
  const hasSource = ledgerColumns.some((col: any) => col.name === "source");
  
  if (!hasSource) {
    console.log("Migrating: Adding voice and narrative authority fields to ledger_entries");
    db.exec(`
      ALTER TABLE ledger_entries ADD COLUMN source TEXT NOT NULL DEFAULT 'text';
      ALTER TABLE ledger_entries ADD COLUMN narrative_weight TEXT NOT NULL DEFAULT 'secondary';
      ALTER TABLE ledger_entries ADD COLUMN speaker_id TEXT;
      ALTER TABLE ledger_entries ADD COLUMN audio_chunk_path TEXT;
      ALTER TABLE ledger_entries ADD COLUMN t_start_ms INTEGER;
      ALTER TABLE ledger_entries ADD COLUMN t_end_ms INTEGER;
      ALTER TABLE ledger_entries ADD COLUMN confidence REAL;
    `);
    
    // Update unique index to be scoped to text messages only
    console.log("Migrating: Updating unique constraint to scope to text messages");
    db.exec(`
      DROP INDEX IF EXISTS idx_ledger_unique_message;
      CREATE UNIQUE INDEX idx_ledger_unique_message
      ON ledger_entries(guild_id, channel_id, message_id)
      WHERE source = 'text';
    `);
  }

  // (Future migrations can go here)
}
