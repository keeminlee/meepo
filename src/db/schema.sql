-- Day 2 + Day 3

CREATE TABLE IF NOT EXISTS npc_instances (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  persona_seed TEXT,
  created_at_ms INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_npc_instances_guild_channel
ON npc_instances(guild_id, channel_id);

-- Ledger v1 (append-only)
CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT 'public'
);

CREATE INDEX IF NOT EXISTS idx_ledger_scope_time
ON ledger_entries(guild_id, channel_id, timestamp_ms);

CREATE INDEX IF NOT EXISTS idx_ledger_message
ON ledger_entries(message_id);

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
  started_at_ms INTEGER NOT NULL,
  ended_at_ms INTEGER,
  started_by_id TEXT,
  started_by_name TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_guild_active
ON sessions(guild_id, ended_at_ms);

-- Optional hardening for ledger idempotency
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_unique_message
ON ledger_entries(message_id);