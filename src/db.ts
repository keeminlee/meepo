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
          label TEXT,
          created_at_ms INTEGER NOT NULL,
          started_at_ms INTEGER NOT NULL,
          ended_at_ms INTEGER,
          started_by_id TEXT,
          started_by_name TEXT,
          source TEXT NOT NULL DEFAULT 'live'
        );
        
        CREATE INDEX idx_sessions_guild_active
        ON sessions(guild_id, ended_at_ms);
        
        -- Restore data
        INSERT INTO sessions 
        SELECT session_id, guild_id, label, created_at_ms, started_at_ms, ended_at_ms, started_by_id, started_by_name, source 
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
          label TEXT,
          created_at_ms INTEGER NOT NULL,
          started_at_ms INTEGER NOT NULL,
          ended_at_ms INTEGER,
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

  // (Future migrations can go here)
}

export async function seedMeepoMemories(): Promise<void> {
  const { seedInitialMeepoMemories } = await import("./ledger/meepo-mind.js");
  await seedInitialMeepoMemories();
}
