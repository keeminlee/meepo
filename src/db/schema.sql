-- Day 2 + Day 3

CREATE TABLE IF NOT EXISTS npc_instances (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  persona_seed TEXT,
  form_id TEXT NOT NULL DEFAULT 'meepo',
  reply_mode TEXT NOT NULL DEFAULT 'text',  -- 'voice' | 'text'
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
-- 
-- Identity Model:
--   session_id = UUID, unique per ingest/run (immutable invariant)
--   label      = user-provided label like "C2E01" (metadata, NOT unique; multiple runs can share a label)
-- 
-- This separation ensures:
--   - Multiple ingestions of the same episode get distinct session_ids
--   - `created_at_ms` provides deterministic ordering for "latest session"
--   - All ledger + meecap queries use session_id (UUID), never label
--
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
-- Supports two modes:
--   - V1 JSON: schema-validated scenes/beats (legacy)
--   - Narrative prose: story-like retelling (current/recommended)
-- Set MEECAP_MODE env var to control pipeline (default: "narrative")
CREATE TABLE IF NOT EXISTS meecaps (
  session_id TEXT PRIMARY KEY,
  meecap_json TEXT,                        -- V1 schema (legacy/compatibility only)
  meecap_narrative TEXT,                   -- Narrative prose (current default)
  model TEXT,                             -- LLM model used (e.g., "claude-opus")
  token_count INTEGER,                    -- Approximate token count
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

-- Meecap Beats: Normalized beat data from narrative meecaps
-- One row per beat; enables efficient querying for character involvement, gravity scoring, etc.
-- Derived deterministically from meecap_narrative (no LLM)
CREATE TABLE IF NOT EXISTS meecap_beats (
  id TEXT PRIMARY KEY,                     -- UUID
  session_id TEXT NOT NULL,                -- FK to meecaps.session_id
  label TEXT,                              -- Session label (e.g., "C2E6") for human-readable filenames
  beat_index INTEGER NOT NULL,             -- Order within session (0, 1, 2, ...)
  beat_text TEXT NOT NULL,                 -- Narrative text of the beat
  line_refs TEXT NOT NULL,                 -- JSON array: [1, 2, 3] or "1-3"
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  
  FOREIGN KEY (session_id) REFERENCES meecaps(session_id) ON DELETE CASCADE,
  UNIQUE(session_id, beat_index)
);

CREATE INDEX IF NOT EXISTS idx_meecap_beats_session
ON meecap_beats(session_id);

-- Ledger idempotency: unique constraint scoped to text messages only
-- (Voice/system use synthetic message_ids that don't need deduplication)
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_unique_message
ON ledger_entries(guild_id, channel_id, message_id)
WHERE source = 'text';

-- MeepoMind: Meepo's foundational knowledge base
-- Global for now (no character scoping yet)
-- No decay logic yet; all memories persist indefinitely
CREATE TABLE IF NOT EXISTS meepo_mind (
  id TEXT PRIMARY KEY,                     -- UUID
  title TEXT NOT NULL,                     -- Memory name (e.g., "The Wanderer's Love")
  content TEXT NOT NULL,                   -- Full memory text
  gravity REAL NOT NULL,                   -- Importance/impact (0.0–1.0)
  certainty REAL NOT NULL,                 -- Confidence level (0.0–1.0)
  created_at_ms INTEGER NOT NULL,          -- When this memory was created
  last_accessed_at_ms INTEGER              -- When this memory was last retrieved (nullable)
);

CREATE INDEX IF NOT EXISTS idx_meepo_mind_gravity
ON meepo_mind(gravity DESC);

-- Phase 1C: Structured event extraction
-- events: Extract structured narrative events from session transcripts
-- Bridges ledger (raw) → meecaps (narrative) with deterministic event records
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,                     -- UUID
  session_id TEXT NOT NULL,                -- FK to sessions
  event_type TEXT NOT NULL,                -- 'action', 'dialogue', 'discovery', 'emotional', 'conflict', 'plan', 'transition', 'recap', 'ooc_logistics'
  participants TEXT NOT NULL,              -- JSON array of normalized character names
  description TEXT NOT NULL,               -- Structured event summary
  confidence REAL NOT NULL,                -- Extraction confidence (0.0–1.0)
  start_index INTEGER,                     -- Start index in transcript (0-based)
  end_index INTEGER,                       -- End index in transcript (0-based, inclusive)
  timestamp_ms INTEGER NOT NULL,           -- When event occurred in session
  created_at_ms INTEGER NOT NULL,
  is_ooc INTEGER DEFAULT 0,                -- 0 = gameplay event, 1 = OOC/meta (skipped in PC exposure analysis)
  
  -- Stable identity: recompiling same session produces same event IDs
  UNIQUE(session_id, start_index, end_index, event_type)
);

CREATE INDEX IF NOT EXISTS idx_events_session
ON events(session_id);

CREATE INDEX IF NOT EXISTS idx_events_type
ON events(event_type);

-- character_event_index: Map PCs to events with exposure classification
-- Supports lookup of "what events involved this PC" and how they were exposed (direct/witnessed)
CREATE TABLE IF NOT EXISTS character_event_index (
  event_id TEXT NOT NULL,                   -- FK to events
  pc_id TEXT NOT NULL,                      -- PC identifier from registry (e.g., 'pc_jamison')
  exposure_type TEXT NOT NULL,              -- 'direct' (spoke in span) or 'witnessed' (party member present but didn't speak)
  created_at_ms INTEGER NOT NULL,
  
  PRIMARY KEY (event_id, pc_id)
);

CREATE INDEX IF NOT EXISTS idx_char_event_pc
ON character_event_index(pc_id);

CREATE INDEX IF NOT EXISTS idx_char_event_exposure
ON character_event_index(exposure_type);

-- meep_usages: Track when and how Meepo responded
-- Supports analysis of response patterns, cost tracking, memory usage
CREATE TABLE IF NOT EXISTS meep_usages (
  id TEXT PRIMARY KEY,                     -- UUID
  session_id TEXT,                         -- FK to sessions (nullable for non-session triggers)
  message_id TEXT NOT NULL,                -- Discord message ID that triggered response
  guild_id TEXT NOT NULL,                  -- Context
  channel_id TEXT NOT NULL,                -- Context
  triggered_at_ms INTEGER NOT NULL,        -- When response was triggered
  response_tokens INTEGER,                 -- LLM tokens in response (null if LLM disabled)
  used_memories TEXT,                      -- JSON array of memory IDs referenced
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_meep_usages_session
ON meep_usages(session_id);

CREATE INDEX IF NOT EXISTS idx_meep_usages_time
ON meep_usages(guild_id, channel_id, triggered_at_ms);

-- meepomind_beats: Narrative beats in Meepo's emotional arc
-- Links structured events to Meepo's memory formation
-- Bridges events → meepo_mind with emotional/narrative significance
CREATE TABLE IF NOT EXISTS meepomind_beats (
  id TEXT PRIMARY KEY,                     -- UUID
  session_id TEXT NOT NULL,                -- FK to sessions
  memory_id TEXT,                          -- FK to meepo_mind (nullable if beat not yet materialized into memory)
  event_id TEXT,                           -- FK to events (nullable if beat is abstract/cross-session)
  beat_type TEXT NOT NULL,                 -- 'growth', 'fracture', 'bonding', 'revelation', 'loss'
  description TEXT NOT NULL,               -- Why this moment mattered
  gravity REAL NOT NULL,                   -- Importance (0.0–1.0), used for memory retrieval weighting
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_meepomind_beats_session
ON meepomind_beats(session_id);

CREATE INDEX IF NOT EXISTS idx_meepomind_beats_memory
ON meepomind_beats(memory_id);

CREATE INDEX IF NOT EXISTS idx_meepomind_beats_gravity
ON meepomind_beats(gravity DESC);

-- Speaker Masks: Diegetic name overrides for Discord users
-- Prevents OOC name leakage into NPC context (e.g., "Keemin (DM)" → "Narrator")
-- DM-only configuration via /meepo set-speaker-mask
CREATE TABLE IF NOT EXISTS speaker_masks (
  guild_id TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  speaker_mask TEXT NOT NULL,              -- Diegetic name (e.g., "Narrator", "Dungeon Master")
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  
  PRIMARY KEY (guild_id, discord_user_id)
);

CREATE INDEX IF NOT EXISTS idx_speaker_masks_guild
ON speaker_masks(guild_id);

-- Meep Transactions: Append-only ledger for meep balance tracking
-- Guild-scoped; per-PC balance derived from SUM(delta)
-- Issuer types: 'dm' (DM reward), 'player' (player spend), 'meepo' (future auto-reward)
CREATE TABLE IF NOT EXISTS meep_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  tx_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  target_discord_id TEXT NOT NULL,        -- Discord ID of PC receiving ±meep
  delta INTEGER NOT NULL,                 -- Always ±1 (spend=-1, reward=+1)
  issuer_type TEXT NOT NULL,              -- 'dm' | 'player' | 'meepo'
  issuer_discord_id TEXT,                 -- NULL for 'meepo', user ID for 'dm'/'player'
  issuer_name TEXT,                       -- User display name or 'Meepo'
  reason TEXT,                            -- Optional transaction reason (unused for now)
  meta_json TEXT                          -- Future: arbitrary metadata
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_meep_guild_tx
ON meep_transactions(guild_id, tx_id);

CREATE INDEX IF NOT EXISTS idx_meep_balance
ON meep_transactions(guild_id, target_discord_id);