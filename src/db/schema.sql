-- Day 2 + Day 3

CREATE TABLE IF NOT EXISTS npc_instances (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  persona_seed TEXT,
  form_id TEXT NOT NULL DEFAULT 'meepo',
  created_at_ms INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_npc_instances_guild_channel
ON npc_instances(guild_id, channel_id);

-- Ledger v1 (append-only)
-- Phase 0: Voice + Narrative Authority extension
CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_norm TEXT,                                 -- Phase 1C: Normalized content with canonical names
  session_id TEXT,                                   -- Phase 1: Session this entry belongs to
  tags TEXT NOT NULL DEFAULT 'public',
  
  -- Voice/narrative extensions (Phase 0)
  source TEXT NOT NULL DEFAULT 'text',              -- 'text' | 'voice' | 'system'
  narrative_weight TEXT NOT NULL DEFAULT 'secondary', -- 'primary' | 'secondary' | 'elevated'
  speaker_id TEXT,                                   -- Discord user_id for voice attribution
  audio_chunk_path TEXT,                             -- Only if STT_SAVE_AUDIO=true
  t_start_ms INTEGER,                                -- Voice segment start time
  t_end_ms INTEGER,                                  -- Voice segment end time
  confidence REAL                                    -- STT confidence (0.0-1.0)
);

CREATE INDEX IF NOT EXISTS idx_ledger_scope_time
ON ledger_entries(guild_id, channel_id, timestamp_ms);

CREATE INDEX IF NOT EXISTS idx_ledger_message
ON ledger_entries(message_id);

CREATE INDEX IF NOT EXISTS idx_ledger_session
ON ledger_entries(session_id);

-- Latches (per guild + channel)
CREATE TABLE IF NOT EXISTS latches (
  key TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_latches_scope
ON latches(guild_id, channel_id);

-- Day 4
-- sessions: one active session per guild (for now)
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  label TEXT,                              -- User-provided label (e.g., "C2E03") for reference
  created_at_ms INTEGER NOT NULL,          -- When this session record was created (immutable timestamp)
  started_at_ms INTEGER NOT NULL,          -- When the session's content began (may differ for ingested sessions)
  ended_at_ms INTEGER,
  started_by_id TEXT,
  started_by_name TEXT,
  source TEXT NOT NULL DEFAULT 'live'  -- 'live' | 'ingest-media' (for offline ingested sessions)
);

CREATE INDEX IF NOT EXISTS idx_sessions_guild_active
ON sessions(guild_id, ended_at_ms);

-- Meecaps: structured session summaries (Phase 1+)
CREATE TABLE IF NOT EXISTS meecaps (
  session_id TEXT PRIMARY KEY,
  meecap_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

-- Ledger idempotency: unique constraint scoped to text messages only
-- (Voice/system use synthetic message_ids that don't need deduplication)
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_unique_message
ON ledger_entries(guild_id, channel_id, message_id)
WHERE source = 'text';