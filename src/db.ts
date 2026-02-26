import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { cfg } from "./config/env.js";
import { getEnv } from "./config/rawEnv.js";
import { resolveCampaignDbPath } from "./dataPaths.js";

let dbSingleton: Database.Database | null = null;
const dbByPath = new Map<string, Database.Database>();
let schemaSqlCache: string | null = null;
let warnedDeprecatedGetDb = false;

function getControlDbPath(): string {
  return path.resolve(cfg.data.root, "control", "control.sqlite");
}

function assertTestDbPathSafety(dbPath: string): void {
  if (getEnv("NODE_ENV") !== "test") return;

  const resolvedDbPath = path.resolve(dbPath);
  const resolvedTmpRoot = path.resolve(os.tmpdir());
  const normalize = (value: string) => path.normalize(value).toLowerCase();

  if (!normalize(resolvedDbPath).startsWith(normalize(resolvedTmpRoot + path.sep))) {
    throw new Error(
      `[db-test-safety] Refusing non-temp DB path in test mode: ${resolvedDbPath}. Expected under ${resolvedTmpRoot}`,
    );
  }
}

function runMigrationsWithSummary(db: Database.Database, dbPath: string): void {
  const migrationsSilent = getEnv("MIGRATIONS_SILENT") === "1";
  let appliedSteps = 0;
  const originalLog = console.log;

  console.log = (...args: unknown[]) => {
    const first = String(args[0] ?? "");
    if (first.startsWith("Migrating:")) {
      appliedSteps += 1;
      return;
    }
    originalLog(...args);
  };

  try {
    applyMigrations(db);
  } finally {
    console.log = originalLog;
  }

  if (!migrationsSilent && appliedSteps > 0) {
    originalLog(`[migrate] applied ${appliedSteps} steps to ${path.resolve(dbPath)}`);
  }
}

function ensureDirFor(dbPath: string) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getSchemaSql(): string {
  if (schemaSqlCache) return schemaSqlCache;
  const schemaPath = path.join(process.cwd(), "src", "db", "schema.sql");
  schemaSqlCache = fs.readFileSync(schemaPath, "utf8");
  return schemaSqlCache;
}

function bootstrapDbAtPath(dbPath: string): Database.Database {
  assertTestDbPathSafety(dbPath);
  ensureDirFor(dbPath);
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(getSchemaSql());
  runMigrationsWithSummary(db, dbPath);
  return db;
}

export function getControlDb(): Database.Database {
  const dbPath = getControlDbPath();
  const existing = dbByPath.get(dbPath);
  if (existing) {
    console.log(`[db-route] ${JSON.stringify({ type: "control", dbPath, status: "cache-hit" })}`);
    return existing;
  }

  const db = bootstrapDbAtPath(dbPath);
  dbByPath.set(dbPath, db);
  console.log(`[db-route] ${JSON.stringify({ type: "control", dbPath, status: "opened-new" })}`);
  return db;
}

export function getDb(): Database.Database {
  if (!warnedDeprecatedGetDb) {
    warnedDeprecatedGetDb = true;
    console.warn("[db] getDb() is deprecated for runtime hot paths. Prefer getControlDb() or getDbForCampaign().");
  }

  if (dbSingleton) return dbSingleton;
  const dbPath = path.resolve(cfg.db.path);
  const existing = dbByPath.get(dbPath);
  if (existing) {
    dbSingleton = existing;
    return existing;
  }
  const db = bootstrapDbAtPath(dbPath);
  dbByPath.set(dbPath, db);
  dbSingleton = db;
  return db;
}

export function getDbForCampaign(campaignSlug: string): Database.Database {
  const dbPath = path.resolve(resolveCampaignDbPath(campaignSlug));
  const existing = dbByPath.get(dbPath);
  if (existing) {
    console.log(`[db-route] ${JSON.stringify({ type: "campaign", slug: campaignSlug, dbPath, status: "cache-hit" })}`);
    return existing;
  }

  const db = bootstrapDbAtPath(dbPath);
  dbByPath.set(dbPath, db);
  console.log(`[db-route] ${JSON.stringify({ type: "campaign", slug: campaignSlug, dbPath, status: "opened-new" })}`);
  return db;
}

function applyMigrations(db: Database.Database) {
  // Migration: Fix npc_instances schema (id should be TEXT, correct column order)
  const npcColumns = db.pragma("table_info(npc_instances)") as any[];
  const idColumn = npcColumns.find((col: any) => col.name === "id");
  
  // Check if id is INTEGER (old schema) instead of TEXT
  if (idColumn && idColumn.type === "INTEGER") {
    console.log("Migrating: Recreating npc_instances table with correct schema");
    
    // Check if table is empty before recreating
    const count = db.prepare("SELECT COUNT(*) as cnt FROM npc_instances").get() as any;
    
    if (count.cnt > 0) {
      console.warn("⚠️  npc_instances has data but schema is wrong. Backing up...");
      db.exec(`
        CREATE TABLE npc_instances_backup AS SELECT * FROM npc_instances;
        DROP TABLE npc_instances;
        
        CREATE TABLE npc_instances (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          guild_id TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          persona_seed TEXT,
          form_id TEXT NOT NULL DEFAULT 'meepo',
          created_at_ms INTEGER NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1
        );
        
        CREATE INDEX idx_npc_instances_guild_channel
        ON npc_instances(guild_id, channel_id);
        
        -- Attempt to restore data (may fail if id values are not valid UUIDs)
        INSERT OR IGNORE INTO npc_instances 
        SELECT id, name, guild_id, channel_id, persona_seed, form_id, created_at_ms, is_active 
        FROM npc_instances_backup;
        
        DROP TABLE npc_instances_backup;
      `);
    } else {
      // Table is empty, safe to recreate
      db.exec(`
        DROP TABLE npc_instances;
        
        CREATE TABLE npc_instances (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          guild_id TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          persona_seed TEXT,
          form_id TEXT NOT NULL DEFAULT 'meepo',
          created_at_ms INTEGER NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1
        );
        
        CREATE INDEX idx_npc_instances_guild_channel
        ON npc_instances(guild_id, channel_id);
      `);
    }
  }
  
  // Migration: Add form_id to npc_instances (Day 7)
  const npcColumnsRefreshed = db.pragma("table_info(npc_instances)") as any[];
  const hasFormId = npcColumnsRefreshed.some((col: any) => col.name === "form_id");
  
  if (!hasFormId) {
    console.log("Migrating: Adding form_id to npc_instances");
    db.exec("ALTER TABLE npc_instances ADD COLUMN form_id TEXT NOT NULL DEFAULT 'meepo'");
  }

  // Migration: Add reply_mode to npc_instances (runtime reply mode control)
  const npcColumnsLatest = db.pragma("table_info(npc_instances)") as any[];
  const hasReplyMode = npcColumnsLatest.some((col: any) => col.name === "reply_mode");
  
  if (!hasReplyMode) {
    console.log("Migrating: Adding reply_mode to npc_instances");
    db.exec("ALTER TABLE npc_instances ADD COLUMN reply_mode TEXT NOT NULL DEFAULT 'text'");
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

  // Migration: Add content_norm to ledger_entries (Phase 1C)
  const hasContentNorm = ledgerColumns.some((col: any) => col.name === "content_norm");
  
  if (!hasContentNorm) {
    console.log("Migrating: Adding content_norm to ledger_entries (Phase 1C)");
    db.exec(`
      ALTER TABLE ledger_entries ADD COLUMN content_norm TEXT;
    `);
  }

  // Migration: Add session_id to ledger_entries (Phase 1 - ingestion support)
  const hasSessionId = ledgerColumns.some((col: any) => col.name === "session_id");
  
  if (!hasSessionId) {
    console.log("Migrating: Adding session_id to ledger_entries (Phase 1)");
    db.exec(`
      ALTER TABLE ledger_entries ADD COLUMN session_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_ledger_session ON ledger_entries(session_id);
    `);
  }

  // Migration: Add meecaps table (Phase 1)
  const tables = db.pragma("table_list") as any[];
  const hasMeecapsTable = tables.some((t: any) => t.name === "meecaps");
  
  if (!hasMeecapsTable) {
    console.log("Migrating: Creating meecaps table (Phase 1)");
    db.exec(`
      CREATE TABLE meecaps (
        session_id TEXT PRIMARY KEY,
        meecap_json TEXT,
        meecap_narrative TEXT,
        model TEXT,
        token_count INTEGER,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );
    `);
  }

  // Migration: Add narrative mode support to meecaps table (Phase 2)
  const meecapColumns = db.pragma("table_info(meecaps)") as any[];
  const hasMeecapNarrative = meecapColumns.some((col: any) => col.name === "meecap_narrative");
  const meecapJsonCol = meecapColumns.find((col: any) => col.name === "meecap_json");
  const hasNotNullJsonCol = meecapJsonCol?.notnull === 1; // Check for NOT NULL constraint
  
  if (!hasMeecapNarrative || hasNotNullJsonCol) {
    if (!hasMeecapNarrative) {
      console.log("Migrating: Adding meecap_narrative, model, and token_count to meecaps table");
    }
    
    if (hasNotNullJsonCol) {
      console.log("Migrating: Recreating meecaps table to make meecap_json nullable");
      db.exec(`
        -- Backup existing data
        CREATE TABLE meecaps_backup AS SELECT * FROM meecaps;
        
        -- Drop old table
        DROP TABLE meecaps;
        
        -- Create new table with updated schema
        CREATE TABLE meecaps (
          session_id TEXT PRIMARY KEY,
          meecap_json TEXT,
          meecap_narrative TEXT,
          model TEXT,
          token_count INTEGER,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL
        );
        
        -- Restore data (preserve existing meecap_json and created/updated times)
        INSERT INTO meecaps (session_id, meecap_json, created_at_ms, updated_at_ms)
        SELECT session_id, meecap_json, created_at_ms, updated_at_ms FROM meecaps_backup;
        
        -- Drop backup
        DROP TABLE meecaps_backup;
      `);
    } else {
      // Just add the columns if table was already flexible
      db.exec(`
        ALTER TABLE meecaps ADD COLUMN meecap_narrative TEXT;
        ALTER TABLE meecaps ADD COLUMN model TEXT;
        ALTER TABLE meecaps ADD COLUMN token_count INTEGER;
      `);
    }
  }

  // Migration: Create meecap_beats table (Feb 14 - Normalized beats from narratives)
  const tablesForBeats = db.pragma("table_list") as any[];
  const hasMeecapBeatsTable = tablesForBeats.some((t: any) => t.name === "meecap_beats");
  
  if (!hasMeecapBeatsTable) {
    console.log("Migrating: Creating meecap_beats table (Normalized narrative beats)");
    db.exec(`
      CREATE TABLE meecap_beats (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        beat_index INTEGER NOT NULL,
        beat_text TEXT NOT NULL,
        line_refs TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        
        FOREIGN KEY (session_id) REFERENCES meecaps(session_id),
        UNIQUE(session_id, beat_index)
      );
      
      CREATE INDEX idx_meecap_beats_session ON meecap_beats(session_id);
    `);
  }

  // Migration: Add label column to meecap_beats (Feb 14+)
  const beatsColumns = db.pragma("table_info(meecap_beats)") as any[];
  const hasLabelColumn = beatsColumns.some((col: any) => col.name === "label");
  
  if (!hasLabelColumn) {
    console.log("Migrating: Adding label column to meecap_beats and backfilling from sessions");
    db.exec(`
      ALTER TABLE meecap_beats ADD COLUMN label TEXT;
    `);
    
    // Backfill labels from sessions table
    try {
      db.prepare(`
        UPDATE meecap_beats 
        SET label = (SELECT label FROM sessions WHERE sessions.session_id = meecap_beats.session_id)
      `).run();
      console.log("Migrating: Backfilled meecap_beats.label from sessions table");
    } catch (err: any) {
      console.warn("Migrating: Could not backfill meecap_beats.label (may not exist yet):", err.message);
    }
  }

  // Migration: Fix sessions table schema (started_by_id/name should be nullable)
  const sessionColumns = db.pragma("table_info(sessions)") as any[];
  const startedByIdCol = sessionColumns.find((col: any) => col.name === "started_by_id");
  
  // Check if started_by_id has NOT NULL constraint (wrong)
  if (startedByIdCol && startedByIdCol.notnull === 1) {
    console.log("Migrating: Recreating sessions table with correct schema (nullable started_by_*)");
    
    // Backup existing data
    const sessionCount = db.prepare("SELECT COUNT(*) as cnt FROM sessions").get() as any;
    
    if (sessionCount.cnt > 0) {
      console.warn("⚠️  sessions table has data, backing up before schema fix...");
      db.exec(`
        CREATE TABLE sessions_backup AS SELECT * FROM sessions;
        DROP TABLE sessions;
        
        CREATE TABLE sessions (
          session_id TEXT PRIMARY KEY,
          guild_id TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'canon',
          mode_at_start TEXT NOT NULL DEFAULT 'ambient',
          label TEXT,
          created_at_ms INTEGER NOT NULL,
          started_at_ms INTEGER NOT NULL,
          ended_at_ms INTEGER,
          ended_reason TEXT,
          started_by_id TEXT,
          started_by_name TEXT,
          source TEXT NOT NULL DEFAULT 'live'
        );
        
        CREATE INDEX idx_sessions_guild_active
        ON sessions(guild_id, ended_at_ms);
        
        -- Restore data
        INSERT INTO sessions 
        SELECT
          session_id,
          guild_id,
          CASE WHEN LOWER(TRIM(COALESCE(label, ''))) = 'chat' THEN 'chat' ELSE 'canon' END,
          CASE
            WHEN LOWER(COALESCE(label, '')) LIKE '%test%' THEN 'lab'
            WHEN LOWER(TRIM(COALESCE(label, ''))) = 'chat' THEN 'ambient'
            ELSE 'ambient'
          END,
          label,
          created_at_ms,
          started_at_ms,
          ended_at_ms,
          NULL,
          started_by_id,
          started_by_name,
          source
        FROM sessions_backup;
        
        DROP TABLE sessions_backup;
      `);
    } else {
      // Empty table, safe to recreate
      db.exec(`
        DROP TABLE sessions;
        
        CREATE TABLE sessions (
          session_id TEXT PRIMARY KEY,
          guild_id TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'canon',
          mode_at_start TEXT NOT NULL DEFAULT 'ambient',
          label TEXT,
          created_at_ms INTEGER NOT NULL,
          started_at_ms INTEGER NOT NULL,
          ended_at_ms INTEGER,
          ended_reason TEXT,
          started_by_id TEXT,
          started_by_name TEXT,
          source TEXT NOT NULL DEFAULT 'live'
        );
        
        CREATE INDEX idx_sessions_guild_active
        ON sessions(guild_id, ended_at_ms);
      `);
    }
  }

  // Migration: Add source to sessions table (Phase 1 - ingestion support)
  const sessionColumnsRefreshed = db.pragma("table_info(sessions)") as any[];
  const hasSessionSource = sessionColumnsRefreshed.some((col: any) => col.name === "source");
  
  if (!hasSessionSource) {
    console.log("Migrating: Adding source to sessions table (Phase 1)");
    db.exec(`
      ALTER TABLE sessions ADD COLUMN source TEXT NOT NULL DEFAULT 'live';
    `);
    
    // Backfill: SQLite sets new column to NULL on existing rows, so explicit backfill is needed
    console.log("Migrating: Backfilling source='live' for existing sessions");
    db.prepare("UPDATE sessions SET source = 'live' WHERE source IS NULL").run();
  }

  // Migration: Add label to sessions table (Phase 1 - ingestion metadata)
  const hasSessionLabel = sessionColumnsRefreshed.some((col: any) => col.name === "label");
  
  if (!hasSessionLabel) {
    console.log("Migrating: Adding label to sessions table (Phase 1)");
    db.exec(`
      ALTER TABLE sessions ADD COLUMN label TEXT;
    `);
  }

  // Migration: Add created_at_ms to sessions table (Phase 1 - reliable ordering for "latest ingested")
  const hasCreatedAtMs = sessionColumnsRefreshed.some((col: any) => col.name === "created_at_ms");
  
  if (!hasCreatedAtMs) {
    console.log("Migrating: Adding created_at_ms to sessions table (Phase 1)");
    db.exec(`
      ALTER TABLE sessions ADD COLUMN created_at_ms INTEGER;
    `);
    
    // Backfill: Use started_at_ms as created_at_ms for existing sessions (best guess)
    console.log("Migrating: Backfilling created_at_ms from started_at_ms for existing sessions");
    db.prepare("UPDATE sessions SET created_at_ms = started_at_ms WHERE created_at_ms IS NULL").run();
    
    // After backfill, make it NOT NULL going forward
    // Note: SQLite doesn't support ALTER COLUMN, so we accept it as nullable for now
    // New sessions will always populate created_at_ms in startSession()
  }

  const sessionColumnsWithCreatedReason = db.pragma("table_info(sessions)") as any[];
  const hasEndedReason = sessionColumnsWithCreatedReason.some((col: any) => col.name === "ended_reason");

  if (!hasEndedReason) {
    console.log("Migrating: Adding ended_reason to sessions table (Phase 4)");
    db.exec(`
      ALTER TABLE sessions ADD COLUMN ended_reason TEXT;
    `);
  }

  // Migration: Add kind to sessions table (Phase 4 - runtime routing)
  const sessionColumnsWithCreatedAt = db.pragma("table_info(sessions)") as any[];
  const hasKind = sessionColumnsWithCreatedAt.some((col: any) => col.name === "kind");

  if (!hasKind) {
    console.log("Migrating: Adding kind to sessions table (Phase 4)");
    db.exec(`
      ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'canon';
    `);

    // Backfill legacy chat sessions by label
    db.prepare(`
      UPDATE sessions
      SET kind = 'chat'
      WHERE LOWER(TRIM(COALESCE(label, ''))) = 'chat'
    `).run();
  }

  // Migration: Add mode_at_start to sessions table (Phase 4 - mode snapshot)
  const sessionColumnsWithKind = db.pragma("table_info(sessions)") as any[];
  const hasModeAtStart = sessionColumnsWithKind.some((col: any) => col.name === "mode_at_start");

  if (!hasModeAtStart) {
    console.log("Migrating: Adding mode_at_start to sessions table (Phase 4)");
    db.exec(`
      ALTER TABLE sessions ADD COLUMN mode_at_start TEXT NOT NULL DEFAULT 'ambient';
    `);

    // Requested rule: labels containing "test" are lab-mode sessions.
    db.prepare(`
      UPDATE sessions
      SET mode_at_start = 'lab'
      WHERE LOWER(COALESCE(label, '')) LIKE '%test%'
    `).run();

    db.prepare(`
      UPDATE sessions
      SET mode_at_start = 'ambient'
      WHERE LOWER(TRIM(COALESCE(label, ''))) = 'chat'
    `).run();

    // Fill any remaining nulls with configured default mode.
    db.prepare(`
      UPDATE sessions
      SET mode_at_start = ?
      WHERE mode_at_start IS NULL
    `).run(cfg.mode);
  }

  // Migration: Create meepo_mind table (Knowledge Base v1)
  const meepoMindTables = db.pragma("table_list") as any[];
  const hasMeepoMind = meepoMindTables.some((t: any) => t.name === "meepo_mind");
  
  if (!hasMeepoMind) {
    console.log("Migrating: Creating meepo_mind table (Knowledge Base v1)");
    db.exec(`
      CREATE TABLE meepo_mind (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        gravity REAL NOT NULL,
        certainty REAL NOT NULL,
        created_at_ms INTEGER NOT NULL,
        last_accessed_at_ms INTEGER
      );
      
      CREATE INDEX idx_meepo_mind_gravity
      ON meepo_mind(gravity DESC);
    `);
  }

  // Migration: Create events table (Phase 1C - MVP Silver)
  const tablesForEvents = db.pragma("table_list") as any[];
  const hasEventsTable = tablesForEvents.some((t: any) => t.name === "events");
  
  if (!hasEventsTable) {
    console.log("Migrating: Creating events table (Phase 1C - Structured Event Extraction)");
    db.exec(`
      CREATE TABLE events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        participants TEXT NOT NULL,
        description TEXT NOT NULL,
        confidence REAL NOT NULL,
        start_index INTEGER,
        end_index INTEGER,
        timestamp_ms INTEGER NOT NULL,
        created_at_ms INTEGER NOT NULL
      );
      
      CREATE INDEX idx_events_session ON events(session_id);
      CREATE INDEX idx_events_type ON events(event_type);
    `);
  }

  // Migration: Add start_index and end_index to events table
  const eventColumnsForIndices = db.pragma("table_info(events)") as any[];
  const hasStartIndex = eventColumnsForIndices.some((col: any) => col.name === "start_index");
  
  if (!hasStartIndex) {
    console.log("Migrating: Adding start_index and end_index to events table");
    db.exec(`
      ALTER TABLE events ADD COLUMN start_index INTEGER;
      ALTER TABLE events ADD COLUMN end_index INTEGER;
    `);
  }

  // Migration: Add UNIQUE constraint to events table (stable event identity across reruns)
  // Allows compile-session.ts to reuse event IDs instead of creating duplicates
  const constraintCheck = db.prepare(
    `SELECT sql FROM sqlite_master 
     WHERE type='table' AND name='events' AND sql LIKE '%UNIQUE(session_id, start_index, end_index, event_type)%'`
  ).get() as any;
  
  if (!constraintCheck) {
    console.log("Migrating: Adding UNIQUE(session_id, start_index, end_index, event_type) to events table");
    // SQLite doesn't allow ALTER TABLE to add UNIQUE constraints, so we recreate the table
    const eventCount = db.prepare("SELECT COUNT(*) as cnt FROM events").get() as any;
    
    if (eventCount.cnt > 0) {
      db.exec(`
        CREATE TABLE events_new (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          participants TEXT NOT NULL,
          description TEXT NOT NULL,
          confidence REAL NOT NULL,
          start_index INTEGER,
          end_index INTEGER,
          timestamp_ms INTEGER NOT NULL,
          created_at_ms INTEGER NOT NULL,
          UNIQUE(session_id, start_index, end_index, event_type)
        );
        
        INSERT INTO events_new 
        SELECT id, session_id, event_type, participants, description, confidence, start_index, end_index, timestamp_ms, created_at_ms 
        FROM events;
        
        DROP TABLE events;
        ALTER TABLE events_new RENAME TO events;
        
        CREATE INDEX idx_events_session ON events(session_id);
        CREATE INDEX idx_events_type ON events(event_type);
      `);
    } else {
      // Table is empty, safe to recreate via DROP + recreate from schema
      db.exec(`
        DROP TABLE events;
        
        CREATE TABLE events (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          participants TEXT NOT NULL,
          description TEXT NOT NULL,
          confidence REAL NOT NULL,
          start_index INTEGER,
          end_index INTEGER,
          timestamp_ms INTEGER NOT NULL,
          created_at_ms INTEGER NOT NULL,
          UNIQUE(session_id, start_index, end_index, event_type)
        );
        
        CREATE INDEX idx_events_session ON events(session_id);
        CREATE INDEX idx_events_type ON events(event_type);
      `);
    }
  }
  // Migration: Add is_ooc column to events table (Phase 1C - OOC Filtering)
  const eventColumnsForIsOoc = db.pragma("table_info(events)") as any[];
  const hasIsOocColumn = eventColumnsForIsOoc.some((col: any) => col.name === "is_ooc");
  
  if (!hasIsOocColumn) {
    // Check for old is_recap column and rename it
    const hasIsRecapColumn = eventColumnsForIsOoc.some((col: any) => col.name === "is_recap");
    
    if (hasIsRecapColumn) {
      console.log("Migrating: Renaming is_recap column to is_ooc in events table");
      db.exec(`
        ALTER TABLE events RENAME COLUMN is_recap TO is_ooc;
      `);
    } else {
      console.log("Migrating: Adding is_ooc column to events table");
      db.exec(`
        ALTER TABLE events ADD COLUMN is_ooc INTEGER DEFAULT 0;
      `);
    }
  }
  // Migration: Create character_event_index table (Phase 1C - MVP Silver)
  // Schema: event_id + pc_id (PK), exposure_type (direct|witnessed)
  const tablesForCharEventIndex = db.pragma("table_list") as any[];
  const hasCharEventIndexTable = tablesForCharEventIndex.some((t: any) => t.name === "character_event_index");
  
  if (!hasCharEventIndexTable) {
    console.log("Migrating: Creating character_event_index table (Phase 1C - PC Exposure Mapping)");
    db.exec(`
      CREATE TABLE character_event_index (
        event_id TEXT NOT NULL,
        pc_id TEXT NOT NULL,
        exposure_type TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        
        PRIMARY KEY (event_id, pc_id)
      );
      
      CREATE INDEX idx_char_event_pc ON character_event_index(pc_id);
      CREATE INDEX idx_char_event_exposure ON character_event_index(exposure_type);
    `);
  } else {
    // Migration: if table exists with old schema, recreate with new schema
    const charEventColumns = db.pragma("table_info(character_event_index)") as any[];
    const hasOldSchema = charEventColumns.some((col: any) => col.name === "character_name_norm");
    
    if (hasOldSchema) {
      console.log("Migrating: Recreating character_event_index with new schema (pc_id + exposure_type)");
      db.exec(`
        DROP TABLE IF EXISTS character_event_index;
        
        CREATE TABLE character_event_index (
          event_id TEXT NOT NULL,
          pc_id TEXT NOT NULL,
          exposure_type TEXT NOT NULL,
          created_at_ms INTEGER NOT NULL,
          
          PRIMARY KEY (event_id, pc_id)
        );
        
        CREATE INDEX idx_char_event_pc ON character_event_index(pc_id);
        CREATE INDEX idx_char_event_exposure ON character_event_index(exposure_type);
      `);
    }

    // Migration: Create causal_loops table (Silver Core v0)
    const tablesForCausalLoops = db.pragma("table_list") as any[];
    const hasCausalLoopsTable = tablesForCausalLoops.some((t: any) => t.name === "causal_loops");

    if (!hasCausalLoopsTable) {
      console.log("Migrating: Creating causal_loops table (Silver Core v0)");
      db.exec(`
        CREATE TABLE causal_loops (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          chunk_id TEXT NOT NULL,
          chunk_index INTEGER NOT NULL,
          actor TEXT NOT NULL,
          start_index INTEGER NOT NULL,
          end_index INTEGER NOT NULL,
          intent_text TEXT,
          intent_type TEXT,
          consequence_type TEXT,
          roll_type TEXT,
          roll_subtype TEXT,
          outcome_text TEXT,
          confidence REAL,
          intent_anchor_index INTEGER,
          consequence_anchor_index INTEGER,
          created_at_ms INTEGER
        );

        CREATE INDEX idx_causal_session_actor ON causal_loops(session_id, actor);
      `);
    } else {
      const causalColumns = db.pragma("table_info(causal_loops)") as any[];
      const hasChunkIndex = causalColumns.some((col: any) => col.name === "chunk_index");
      const hasIntentAnchor = causalColumns.some((col: any) => col.name === "intent_anchor_index");
      const hasConsequenceAnchor = causalColumns.some(
        (col: any) => col.name === "consequence_anchor_index"
      );

      if (!hasChunkIndex) {
        console.log("Migrating: Adding chunk_index to causal_loops");
        db.exec("ALTER TABLE causal_loops ADD COLUMN chunk_index INTEGER NOT NULL DEFAULT 0");
      }

      if (!hasIntentAnchor) {
        console.log("Migrating: Adding intent_anchor_index to causal_loops");
        db.exec("ALTER TABLE causal_loops ADD COLUMN intent_anchor_index INTEGER");
      }

      if (!hasConsequenceAnchor) {
        console.log("Migrating: Adding consequence_anchor_index to causal_loops");
        db.exec("ALTER TABLE causal_loops ADD COLUMN consequence_anchor_index INTEGER");
      }

      const indexes = db.pragma("index_list(causal_loops)") as any[];
      const hasIndex = indexes.some((idx: any) => idx.name === "idx_causal_session_actor");
      if (!hasIndex) {
        db.exec("CREATE INDEX idx_causal_session_actor ON causal_loops(session_id, actor)");
      }
    }
  }

  // Migration: Create graph tables (Intent-Consequence Graph v0)
  const tablesForCausalLinks = db.pragma("table_list") as any[];
  const hasCausalLinks = tablesForCausalLinks.some((t: any) => t.name === "causal_links");

  if (!hasCausalLinks) {
    console.log("Migrating: Creating causal_links table (Cause-Effect Links v1)");
    db.exec(`
      CREATE TABLE IF NOT EXISTS causal_links (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        actor TEXT NOT NULL,

        cause_text TEXT,
        cause_type TEXT,
        cause_mass REAL,
        cause_anchor_index INTEGER,

        effect_text TEXT,
        effect_type TEXT,
        effect_mass REAL,
        effect_anchor_index INTEGER,

        mass_base REAL,
        mass REAL,
        link_mass REAL,
        center_index INTEGER,
        mass_boost REAL,

        strength_ce REAL,
        strength REAL,
        kernel_version TEXT,
        kernel_params_json TEXT,
        extracted_at_ms INTEGER,

        intent_text TEXT,
        intent_type TEXT,
        intent_strength TEXT,
        intent_anchor_index INTEGER,
        consequence_text TEXT,
        consequence_type TEXT,
        consequence_anchor_index INTEGER,
        distance INTEGER,
        score REAL,
        claimed INTEGER,
        created_at_ms INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_causal_links_session ON causal_links(session_id);
      CREATE INDEX IF NOT EXISTS idx_causal_links_session_anchor ON causal_links(session_id, cause_anchor_index);
      CREATE INDEX IF NOT EXISTS idx_causal_links_session_claimed ON causal_links(session_id, claimed);
    `);
  } else {
    const causalLinkColumns = db.pragma("table_info(causal_links)") as any[];
    const hasColumn = (name: string) => causalLinkColumns.some((col: any) => col.name === name);

    const maybeAddColumn = (name: string, typeSql: string) => {
      if (!hasColumn(name)) {
        console.log(`Migrating: Adding ${name} to causal_links`);
        db.exec(`ALTER TABLE causal_links ADD COLUMN ${name} ${typeSql}`);
      }
    };

    maybeAddColumn("cause_text", "TEXT");
    maybeAddColumn("cause_type", "TEXT");
    maybeAddColumn("cause_mass", "REAL");
    maybeAddColumn("cause_anchor_index", "INTEGER");
    maybeAddColumn("effect_text", "TEXT");
    maybeAddColumn("effect_type", "TEXT");
    maybeAddColumn("effect_mass", "REAL");
    maybeAddColumn("effect_anchor_index", "INTEGER");
    maybeAddColumn("mass_base", "REAL");
    maybeAddColumn("mass", "REAL");
    maybeAddColumn("link_mass", "REAL");
    maybeAddColumn("center_index", "INTEGER");
    maybeAddColumn("mass_boost", "REAL");
    maybeAddColumn("strength_ce", "REAL");
    maybeAddColumn("strength", "REAL");
    maybeAddColumn("kernel_version", "TEXT");
    maybeAddColumn("kernel_params_json", "TEXT");
    maybeAddColumn("extracted_at_ms", "INTEGER");

    db.exec(`
      UPDATE causal_links
      SET
        cause_text = COALESCE(cause_text, intent_text),
        cause_type = COALESCE(cause_type, intent_type),
        cause_anchor_index = COALESCE(cause_anchor_index, intent_anchor_index),
        effect_text = COALESCE(effect_text, consequence_text),
        effect_type = COALESCE(effect_type, consequence_type),
        effect_anchor_index = COALESCE(effect_anchor_index, consequence_anchor_index),
        strength_ce = COALESCE(strength_ce, score),
        strength = COALESCE(strength, score),
        kernel_version = COALESCE(kernel_version, 'cause-effect-kernel-v1'),
        kernel_params_json = COALESCE(kernel_params_json, '{}'),
        extracted_at_ms = COALESCE(extracted_at_ms, created_at_ms)
      WHERE
        cause_text IS NULL
        OR cause_type IS NULL
        OR cause_anchor_index IS NULL
        OR effect_text IS NULL
        OR effect_type IS NULL
        OR effect_anchor_index IS NULL
        OR strength_ce IS NULL
        OR strength IS NULL
        OR kernel_version IS NULL
        OR kernel_params_json IS NULL
        OR extracted_at_ms IS NULL;
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_causal_links_session ON causal_links(session_id);
      CREATE INDEX IF NOT EXISTS idx_causal_links_session_anchor ON causal_links(session_id, cause_anchor_index);
      CREATE INDEX IF NOT EXISTS idx_causal_links_session_claimed ON causal_links(session_id, claimed);
    `);
  }

  // Migration: Create graph tables (Intent-Consequence Graph v0)
  const tablesForIntentGraph = db.pragma("table_list") as any[];
  const hasIntentNodes = tablesForIntentGraph.some((t: any) => t.name === "intent_nodes");
  const hasConsequenceNodes = tablesForIntentGraph.some((t: any) => t.name === "consequence_nodes");
  const hasIntentEdges = tablesForIntentGraph.some((t: any) => t.name === "intent_consequence_edges");

  if (!hasIntentNodes || !hasConsequenceNodes || !hasIntentEdges) {
    console.log("Migrating: Creating intent graph tables (Intent-Consequence Graph v0)");
    db.exec(`
      CREATE TABLE IF NOT EXISTS intent_nodes (
        intent_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        chunk_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        anchor_index INTEGER NOT NULL,
        intent_type TEXT NOT NULL,
        text TEXT NOT NULL,
        source TEXT NOT NULL,
        is_strong_intent INTEGER DEFAULT 1,
        created_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_intent_nodes_session_chunk ON intent_nodes(session_id, chunk_id);
      CREATE INDEX IF NOT EXISTS idx_intent_nodes_session_actor ON intent_nodes(session_id, actor_id);

      CREATE TABLE IF NOT EXISTS consequence_nodes (
        consequence_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        chunk_id TEXT NOT NULL,
        anchor_index INTEGER NOT NULL,
        consequence_type TEXT NOT NULL,
        roll_type TEXT,
        roll_subtype TEXT,
        text TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_consequence_nodes_session_chunk ON consequence_nodes(session_id, chunk_id);

      CREATE TABLE IF NOT EXISTS intent_consequence_edges (
        edge_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        chunk_id TEXT NOT NULL,
        intent_id TEXT NOT NULL,
        consequence_id TEXT NOT NULL,
        distance INTEGER NOT NULL,
        distance_score REAL NOT NULL,
        lexical_score REAL NOT NULL,
        heuristic_boost REAL NOT NULL,
        base_score REAL NOT NULL,
        adjusted_score REAL NOT NULL,
        shared_terms_json TEXT NOT NULL,
        flags_json TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_edges_session_chunk ON intent_consequence_edges(session_id, chunk_id);
      CREATE INDEX IF NOT EXISTS idx_edges_session_intent ON intent_consequence_edges(session_id, intent_id);
      CREATE INDEX IF NOT EXISTS idx_edges_session_consequence ON intent_consequence_edges(session_id, consequence_id);
    `);
  }

  // Migration: Create meep_usages table (Phase 1C - MVP Silver)
  const tablesForMeepUsages = db.pragma("table_list") as any[];
  const hasMeepUsagesTable = tablesForMeepUsages.some((t: any) => t.name === "meep_usages");
  
  if (!hasMeepUsagesTable) {
    console.log("Migrating: Creating meep_usages table (Phase 1C - Meepo Usage Tracking)");
    db.exec(`
      CREATE TABLE meep_usages (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        message_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        triggered_at_ms INTEGER NOT NULL,
        response_tokens INTEGER,
        used_memories TEXT,
        created_at_ms INTEGER NOT NULL
      );
      
      CREATE INDEX idx_meep_usages_session ON meep_usages(session_id);
      CREATE INDEX idx_meep_usages_time ON meep_usages(guild_id, channel_id, triggered_at_ms);
    `);
  }

  // Migration: Create meepomind_beats table (Phase 1C - MVP Gold)
  const tablesForMeepomindBeats = db.pragma("table_list") as any[];
  const hasMeepomindBeatsTable = tablesForMeepomindBeats.some((t: any) => t.name === "meepomind_beats");
  
  if (!hasMeepomindBeatsTable) {
    console.log("Migrating: Creating meepomind_beats table (Phase 1C - Meepo Emotional Beats)");
    db.exec(`
      CREATE TABLE meepomind_beats (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        memory_id TEXT,
        event_id TEXT,
        beat_type TEXT NOT NULL,
        description TEXT NOT NULL,
        gravity REAL NOT NULL,
        created_at_ms INTEGER NOT NULL
      );
      
      CREATE INDEX idx_meepomind_beats_session ON meepomind_beats(session_id);
      CREATE INDEX idx_meepomind_beats_memory ON meepomind_beats(memory_id);
      CREATE INDEX idx_meepomind_beats_gravity ON meepomind_beats(gravity DESC);
    `);
  }

  // Migration: Add source metadata columns to meep_transactions (V0 Missions)
  const meepColumns = db.pragma("table_info(meep_transactions)") as any[];
  const hasSourceType = meepColumns.some((col: any) => col.name === "source_type");
  
  if (!hasSourceType) {
    console.log("Migrating: Adding source metadata to meep_transactions (V0 Missions)");
    db.exec(`
      ALTER TABLE meep_transactions ADD COLUMN source_type TEXT DEFAULT 'dm';
      ALTER TABLE meep_transactions ADD COLUMN source_ref TEXT;
      ALTER TABLE meep_transactions ADD COLUMN session_id TEXT;
      ALTER TABLE meep_transactions ADD COLUMN anchor_session_id TEXT;
      ALTER TABLE meep_transactions ADD COLUMN anchor_line_index INTEGER;
    `);
  }

  // Migration: Add source metadata to meepo_mind (Layer 0 - Conversation Memory)
  const mindColumns = db.pragma("table_info(meepo_mind)") as any[];
  const hasMindSourceType = mindColumns.some((col: any) => col.name === "source_type");

  if (!hasMindSourceType) {
    console.log("Migrating: Adding source metadata to meepo_mind (Layer 0)");
    db.exec(`
      ALTER TABLE meepo_mind ADD COLUMN source_type TEXT;
      ALTER TABLE meepo_mind ADD COLUMN source_ref TEXT;
    `);
  }

  // Migration: Persona Overhaul v1 - guild_runtime_state.active_persona_id
  const grsColumns = db.pragma("table_info(guild_runtime_state)") as any[];
  const hasActivePersonaId = grsColumns.some((col: any) => col.name === "active_persona_id");
  if (!hasActivePersonaId) {
    console.log("Migrating: Adding active_persona_id to guild_runtime_state (Persona Overhaul v1)");
    db.exec("ALTER TABLE guild_runtime_state ADD COLUMN active_persona_id TEXT");
    db.prepare("UPDATE guild_runtime_state SET active_persona_id = ? WHERE active_persona_id IS NULL").run("meta_meepo");
  }

  const grsColumnsAfterPersona = db.pragma("table_info(guild_runtime_state)") as any[];
  const hasActiveMode = grsColumnsAfterPersona.some((col: any) => col.name === "active_mode");
  if (!hasActiveMode) {
    console.log("Migrating: Adding active_mode to guild_runtime_state (Phase 4)");
    db.exec("ALTER TABLE guild_runtime_state ADD COLUMN active_mode TEXT");
    db.prepare("UPDATE guild_runtime_state SET active_mode = ? WHERE active_mode IS NULL").run(cfg.mode);
  }

  // Migration: Persona Overhaul v1 - meepo_mind.mindspace
  const mindColsAfter = db.pragma("table_info(meepo_mind)") as any[];
  const hasMindspace = mindColsAfter.some((col: any) => col.name === "mindspace");
  if (!hasMindspace) {
    console.log("Migrating: Adding mindspace to meepo_mind (Persona Overhaul v1)");
    db.exec("ALTER TABLE meepo_mind ADD COLUMN mindspace TEXT");
    db.prepare("UPDATE meepo_mind SET mindspace = ? WHERE mindspace IS NULL").run("campaign:global:legacy");
  }
  // Ensure index exists (new installs have column from schema; old installs just got it above)
  db.exec("CREATE INDEX IF NOT EXISTS idx_meepo_mind_mindspace ON meepo_mind(mindspace, gravity DESC)");

  // Migration: Persona Overhaul v1 - meep_usages.persona_id, mindspace
  const meepUsageColumns = db.pragma("table_info(meep_usages)") as any[];
  const hasPersonaId = meepUsageColumns.some((col: any) => col.name === "persona_id");
  if (!hasPersonaId && meepUsageColumns.length > 0) {
    console.log("Migrating: Adding persona_id and mindspace to meep_usages (Persona Overhaul v1)");
    db.exec("ALTER TABLE meep_usages ADD COLUMN persona_id TEXT");
    db.exec("ALTER TABLE meep_usages ADD COLUMN mindspace TEXT");
  }

  // Migration: Create meepo_convo_log table (Layer 0 - Conversation Memory)
  const tablesForConvoLog = db.pragma("table_list") as any[];
  const hasConvoLog = tablesForConvoLog.some((t: any) => t.name === "meepo_convo_log");
  
  if (!hasConvoLog) {
    console.log("Migrating: Creating meepo_convo_log table (Layer 0 - Conversation Memory)");
    db.exec(`
      CREATE TABLE meepo_convo_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT,
        speaker_id TEXT,
        speaker_name TEXT,
        role TEXT CHECK(role IN ('player','meepo','system')) NOT NULL,
        content_raw TEXT NOT NULL,
        content_norm TEXT,
        ts_ms INTEGER NOT NULL,
        FOREIGN KEY(session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
      );
      
      CREATE INDEX idx_meepo_convo_log_session ON meepo_convo_log(session_id, ts_ms);
      CREATE INDEX idx_meepo_convo_log_channel ON meepo_convo_log(channel_id, ts_ms);
      CREATE UNIQUE INDEX idx_meepo_convo_log_message ON meepo_convo_log(message_id) WHERE message_id IS NOT NULL;
    `);
  }

  // Migration: Create meepo_convo_candidate table (Layer 0 - Conversation Memory)
  const tablesForConvoCandidate = db.pragma("table_list") as any[];
  const hasConvoCandidate = tablesForConvoCandidate.some((t: any) => t.name === "meepo_convo_candidate");
  
  if (!hasConvoCandidate) {
    console.log("Migrating: Creating meepo_convo_candidate table (Layer 0 - Conversation Memory)");
    db.exec(`
      CREATE TABLE meepo_convo_candidate (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_log_id INTEGER NOT NULL,
        candidate_type TEXT,
        candidate_text TEXT NOT NULL,
        reason TEXT,
        status TEXT CHECK(status IN ('pending','approved','rejected')) DEFAULT 'pending',
        reviewed_ts_ms INTEGER,
        review_notes TEXT,
        created_ts_ms INTEGER NOT NULL,
        FOREIGN KEY(source_log_id) REFERENCES meepo_convo_log(id) ON DELETE CASCADE,
        UNIQUE(source_log_id, candidate_type)
      );
      
      CREATE INDEX idx_meepo_convo_candidate_status ON meepo_convo_candidate(status);
    `);
  }

  // Migration: Campaign-scoped registry - guild_config (campaign_slug, default_persona_id)
  const tablesForGuildConfig = db.pragma("table_list") as any[];
  const hasGuildConfig = tablesForGuildConfig.some((t: any) => t.name === "guild_config");
  if (!hasGuildConfig) {
    console.log("Migrating: Creating guild_config table (Campaign-Scoped Registry)");
    db.exec(`
      CREATE TABLE guild_config (
        guild_id TEXT PRIMARY KEY,
        campaign_slug TEXT NOT NULL,
        dm_role_id TEXT,
        default_persona_id TEXT
      );
    `);
  }

  // Migration: Latches per (guild, channel, user) — drop old key-based table if present
  const tableListForLatches = db.pragma("table_list") as any[];
  const hasLatches = tableListForLatches.some((t: any) => t.name === "latches");
  if (hasLatches) {
    const latchCols = db.pragma("table_info(latches)") as any[];
    const hasKeyCol = latchCols.some((c: any) => c.name === "key");
    if (hasKeyCol) {
      console.log("Migrating: Recreating latches as per-user (guild, channel, user_id)");
      db.exec("DROP TABLE latches");
      db.exec(`
        CREATE TABLE latches (
          guild_id TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          expires_at_ms INTEGER NOT NULL,
          turn_count INTEGER NOT NULL DEFAULT 0,
          max_turns INTEGER,
          PRIMARY KEY (guild_id, channel_id, user_id)
        );
        CREATE INDEX idx_latches_scope ON latches(guild_id, channel_id);
      `);
    }
  }

  // Migration: meepo_interactions (Tier S/A retrieval anchors)
  const tablesForMeepoInteractions = db.pragma("table_list") as any[];
  const hasMeepoInteractions = tablesForMeepoInteractions.some((t: any) => t.name === "meepo_interactions");
  if (!hasMeepoInteractions) {
    console.log("Migrating: Creating meepo_interactions table (Tier S/A)");
    db.exec(`
      CREATE TABLE meepo_interactions (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        session_id TEXT,
        persona_id TEXT NOT NULL,
        tier TEXT NOT NULL,
        trigger TEXT NOT NULL,
        speaker_id TEXT NOT NULL,
        start_line_index INTEGER,
        end_line_index INTEGER,
        created_at_ms INTEGER NOT NULL,
        meta_json TEXT
      );
      CREATE INDEX idx_meepo_interactions_guild_persona ON meepo_interactions(guild_id, persona_id);
      CREATE INDEX idx_meepo_interactions_session ON meepo_interactions(session_id);
      CREATE INDEX idx_meepo_interactions_created ON meepo_interactions(created_at_ms DESC);
    `);
  }

  // Migration: gold_memory table (curated campaign memory rows)
  const tablesForGold = db.pragma("table_list") as any[];
  const hasGoldMemory = tablesForGold.some((t: any) => t.name === "gold_memory");
  if (!hasGoldMemory) {
    console.log("Migrating: Creating gold_memory table");
    db.exec(`
      CREATE TABLE gold_memory (
        guild_id TEXT NOT NULL,
        campaign_slug TEXT NOT NULL,
        memory_key TEXT NOT NULL,
        character TEXT NOT NULL,
        summary TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]',
        source_ids_json TEXT NOT NULL DEFAULT '[]',
        gravity REAL NOT NULL DEFAULT 1.0,
        certainty REAL NOT NULL DEFAULT 1.0,
        resilience REAL NOT NULL DEFAULT 1.0,
        status TEXT NOT NULL DEFAULT 'active',
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY (guild_id, campaign_slug, memory_key)
      );
      CREATE INDEX idx_gold_memory_scope ON gold_memory(guild_id, campaign_slug, character);
      CREATE INDEX idx_gold_memory_status ON gold_memory(guild_id, campaign_slug, status, updated_at_ms DESC);
    `);
  }

  // Migration: gold_memory_candidate table (pending/approved/rejected queue)
  const tablesForGoldCand = db.pragma("table_list") as any[];
  const hasGoldCandidate = tablesForGoldCand.some((t: any) => t.name === "gold_memory_candidate");
  if (!hasGoldCandidate) {
    console.log("Migrating: Creating gold_memory_candidate table");
    db.exec(`
      CREATE TABLE gold_memory_candidate (
        guild_id TEXT NOT NULL,
        campaign_slug TEXT NOT NULL,
        candidate_key TEXT NOT NULL,
        session_id TEXT,
        character TEXT NOT NULL,
        summary TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]',
        source_ids_json TEXT NOT NULL DEFAULT '[]',
        gravity REAL NOT NULL DEFAULT 1.0,
        certainty REAL NOT NULL DEFAULT 1.0,
        resilience REAL NOT NULL DEFAULT 1.0,
        status TEXT NOT NULL DEFAULT 'pending',
        reviewed_at_ms INTEGER,
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY (guild_id, campaign_slug, candidate_key)
      );
      CREATE INDEX idx_gold_candidate_scope ON gold_memory_candidate(guild_id, campaign_slug, status, updated_at_ms DESC);
    `);
  }

  // (Future migrations can go here)
}

export async function seedMeepoMemories(): Promise<void> {
  const { seedInitialMeepoMemories } = await import("./ledger/meepo-mind.js");
  await seedInitialMeepoMemories();
}
