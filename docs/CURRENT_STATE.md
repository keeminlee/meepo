# Meepo Bot - Current State (February 14, 2026)

**Status:** V0 complete, MeepoMind (V0.1) Phase 2-3 in progress  
**Last Updated:** February 14, 2026

---

## Quick Start

```bash
npm run dev:bot        # Start bot with hot-reload
npm run dev:deploy     # Register/update slash commands in Discord
npx tsc --noEmit      # Type-check code
```

### Test in Discord

```
/meepo wake                              # Start session (auto-generates UUID)
meepo: hello                             # Auto-latch responds
/session transcript range=since_start    # View all text+voice from session
/session meecap                          # Generate Meecap (4-8 scenes, 1-4 beats)
/session recap                           # DM summary (default: style=dm, source=primary)
/session recap style=narrative           # Meecap-structured prose with detail
/meepo join                              # Enter voice channel
/meepo stt on                            # Enable transcription
<speak: "meepo, help me">               # STT → LLM → TTS closed loop
```

---

## Project Vision

**Meepo** is a **diegetic NPC for Discord D&D sessions** — a witness and embodied presence that:
- Listens and remembers (with guardrails)
- Exists *inside* the world, not above it
- Never hallucinates lore or breaks diegetic boundaries
- Remembers people and relationships, not everything

### What Meepo Is NOT
- A rules engine
- A DM assistant
- An omniscient narrator
- An autonomous agent

### What Meepo IS
- A baby celestial NPC (or transforms into Xoblob the mimic)
- A narrative continuity anchor
- Emotionally shaped by what matters to the party

---

## Architecture Overview

### Dual Knowledge System

**1. Omniscient Ledger** ✅ Complete
- Append-only log of ALL messages (text + voice)
- Narrative authority tiers: `primary` (voice/system), `secondary` (text chatter), `elevated` (DM-marked)
- Source of truth for DM tools and session recaps
- Session-scoped via UUID reference

**2. NPC Mind** 🔄 Phase 2-3 (In Progress)
- Character-centric, emotionally weighted memory
- Shaped by people, love, tenderness, moral fracture
- Built on Meecap beats scored by gravity
- Future: Auto-injected into LLM prompts

### Data Flow

```
Discord Message/Voice
    ↓
Ledger Entry (with narrative_weight)
    ↓
Session-scoped grouping (UUID)
    ↓
[DM Tools] ←→ [Meecap Generation] ←→ [Character Retrieval]
    ↓            ↓                        ↓
Recap      Emotion Beats         LLM Response
```

---

## What's Implemented

### Core Systems ✅

#### Voice & Speech
- **STT (Speech-to-Text):** OpenAI Whisper + domain normalization
- **TTS (Text-to-Speech):** OpenAI gpt-4o-mini-tts with chunking
- **Voice Loop:** Closed STT → LLM → TTS with feedback loop protection
- **Anti-noise Gating:** Configurable threshold to filter background noise
- **Voice State Tracking:** Guild-scoped connection management

#### Text I/O
- Message reception with auto-latch (90s conversation window)
- Address detection via prefix (`meepo:`) or mention (`@meepo`)
- Command-less natural interaction (just speak in voice channel)

#### Personas
- **Meepo** (default): Baby celestial, replies with "meep" suffix
- **Xoblob**: Transform form (Entity-13V mimic), riddle-based personality
- **StyleSpec system**: Per-persona customizable traits + system prompts

#### LLM Integration
- OpenAI API with graceful fallbacks
- Kill-switch support (disables responses, logs errors)
- Token-limited prompts with safeguards (3000-16000 max tokens depending on task)
- Persona-driven system prompts with registry validation

#### Session Management
- **Start:** `/meepo wake` generates UUID session, auto-grouped text+voice
- **Stop:** `/meepo sleep` or timeout-based
- **Labeling:** Optional user labels (e.g., "C2E06") for reference
- **Offline Ingestion:** Tool to ingest campaign recordings into same DB

#### Ledger & Logging
- SQLite append-only log with deduplication (via message_id index)
- Centralized logger with scopes: `voice`, `stt`, `tts`, `ledger`, `llm`, `db`, `session`, `boot`, `meepo`
- Log levels: `error|warn|info|debug|trace`
- Environment-configurable format (pretty/json)

#### Registry System ✅
- **YAML-based character registry** (source of truth)
  - `data/registry/pcs.yml` — 6 playable characters
  - `data/registry/npcs.yml` — 3 NPCs (includes Meepo)
  - `data/registry/locations.yml` — 3 places
  - `data/registry/ignore.yml` — 79 stopwords for filtering
  - `data/registry/decisions.pending.yml` — Review queue for new candidates
- **Name Discovery Tool:** Offline scanner that proposes new names from ledger
- **Name Normalization:** Regex-based (no LLM), longest-match-first, alias-aware
- **Live Integration:** Voice transcripts normalized at ingest + storage of both raw + normalized

#### Meecap System ✅
- **Meecap V1 Schema:** Structured post-session segmentation
  - 4-8 scenes (narrative acts)
  - 1-4 beats per scene (emotional memory units)
  - Ledger-ID anchoring (stable references via UUID ranges)
  - Evidence lists for beat justification
- **Generation:** LLM-driven with validated JSON schema
- **Validator:** Comprehensive checks (ID existence, range ordering, evidence non-empty)
- **Regenerable:** Can overwrite via `/session meecap --force`
- **Database Persistence:** UPSERT pattern in `meecaps` table
- **Disk Export:** JSON files for git diffing and Discord review

#### Commands
- `/meepo wake|sleep|status|hush|transform|join|leave|stt` — Instance management
- `/session meecap [--force] [--source primary|full]` — Generate/regenerate Meecap
- `/session recap [range] [style=dm|narrative|party] [source=primary|full] [--force_meecap]` — View recap
- `/session transcript [range]` — Raw transcript view
- `/session label [session_id]` — Assign or view session labels
- `/session view [scope=all|unlabeled]` — List sessions with metadata
- `/deploy-dev` — Register commands in Discord
- `/ping` — Health check

#### Tools (CLI)
- `tools/ingest-media.ts` — Offline media ingestion (extract audio, transcribe, generate session)
- `src/tools/compile-and-export-events.ts` — Bronze → Silver event compilation
- `src/tools/compile-and-export-events-batch.ts` — Batch compile multiple sessions
- `src/tools/scan-names.ts` — Find unknown names in ledger
- `src/tools/review-names.ts` — Interactive CLI for registry triage
- `src/tools/cleanup-canonical-aliases.ts` — Validate alias consistency

---

## Database Schema

### Core Tables

```sql
-- NPC Instance (one per guild)
npc_instances
  · id (PK), guild_id, name, form_id ('meepo'|'xoblob')
  · persona_seed (optional custom traits), created_at_ms, is_active

-- Ledger (immutable source)
ledger_entries
  · id (PK), guild_id, channel_id, message_id (unique index)
  · author_id, author_name, timestamp_ms, content
  · session_id (UUID reference → sessions.session_id)
  · source ('text'|'voice'|'system')
  · narrative_weight ('primary'|'secondary'|'elevated')
  · speaker_id (for voice), audio_chunk_path, t_start_ms, t_end_ms, confidence
  · content_norm (normalized text for consistency)
  · created_at_ms (for deterministic ordering)

-- Sessions (grouped ledger)
sessions
  · session_id (TEXT PRIMARY KEY, UUID) ← the invariant
  · guild_id, label (optional user metadata), source ('live'|'ingest-media')
  · started_at_ms, ended_at_ms
  · started_by_id, started_by_name
  · created_at_ms (immutable creation timestamp, used for "latest ingested" ordering)

-- Meecaps (derived artifact / under review Feb 14)
meecaps
  · session_id (PK → sessions.session_id)
  · meecap_narrative (TEXT, generated prose + transcript)
  · meecap_json (TEXT, beats-only JSON derived deterministically from narrative)
  · model (model name, e.g. 'claude-opus')
  · created_at_ms, updated_at_ms

⚠️  Narrative-mode meecaps need regeneration after Feb 14 transcript consolidation.
    Consider truncating table before batch regeneration.

-- Latches (conversation window state)
latches
  · key (PK), guild_id, channel_id, expires_at_ms
```

### Design Notes
- `session_id` is **generated UUID** (immutable, collision-resistant)
- `label` is user-provided metadata (NOT unique; can have multiple ingests with same label)
- `created_at_ms` determines "latest ingested" session (deterministic ordering)
- All migrations auto-apply on startup with safe defaults
- Messaging deduplication via message_id unique index

---

## Features by Readiness

### ✅ Shipping in V0
- Text + voice I/O (STT+LLM+TTS loop)
- Persona system (Meepo, Xoblob)
- Natural conversation (address-triggered, latch-windowed)
- Session tracking (auto-start on wake, UUID-based grouping)
- Ledger-first architecture (omniscient + voice-primary)
- Transcript + recap commands (DM-only, range filtering)
- Character registry (YAML, with name discovery tools)
- Meecap generation (scene/beat segmentation, ledger-anchored)
- Batch ingestion tools (offline media → session DB)
- **Unified Transcript Builder** (consolidated Meecap + Events logic) ✨ **NEW Feb 14**

### 🔄 Phase 2-3 (In Progress)
- **Gravity Scoring:** Post-session emotional weight assignment (Costly Love, Tenderness, Moral Fracture)
- **Character-Scoped Retrieval:** Filter beats by PC involved, order by gravity
- **Memory Integration:** Inject retrieved beats into LLM response prompts
- **Meecap Table Redesign:** Current structure under review; may require schema changes

### ⏳ Future (Deferred)
- Pronoun resolution (for cleaner narrative)
- Topic packs (thematic beat clustering)
- Wanderer routing (advanced state machine)
- Persistent impression tracking (PC-NPC relationship arcs)

---

## Configuration

Required environment variables:

```env
# Discord
DISCORD_TOKEN=<bot_token>
DM_ROLE_ID=<role_id_for_dm_only_commands>

# OpenAI
OPENAI_API_KEY=<api_key>

# Database
DATA_DB_PATH=./data/bot.sqlite

# Voice
VOICE_CHUNK_SIZE_MS=60000           # Audio chunk size
VOICE_SILENCE_THRESHOLD_DB=-40      # Noise gate (-40 = aggressive)
VOICE_END_SILENCE_MS=700            # End utterance after silence
VOICE_REPLY_COOLDOWN_MS=5000        # Prevent spam

# STT/TTS
STT_PROVIDER=openai                 # or 'noop'|'debug'
TTS_ENABLED=true
TTS_CHUNK_SIZE_CHARS=350
TTS_OPENAI_MODEL=gpt-4o-mini-tts

# Logging
LOG_LEVEL=info                      # error|warn|info|debug|trace
LOG_SCOPES=                         # Leave empty for all, or: voice,stt,tts,...
LOG_FORMAT=pretty                   # pretty|json

# Optional
STT_SAVE_AUDIO=false                # Save audio chunks to disk
AUDIO_FX_ENABLED=false              # Audio effects (pitch, reverb)
MEEPO_CONFIG_GUILD_ID=<guild_id>    # For multi-guild setup
```

---

## Module Organization

```
src/
├── bot.ts                          # Discord event loop
├── db.ts                           # SQLite + migrations
├── pidlock.ts                      # Single-instance lock
│
├── meepo/
│   ├── state.ts                    # Instance lifecycle (wake/sleep/transform)
│   ├── triggers.ts                 # Address detection
│   └── nickname.ts                 # Discord nickname management
│
├── personas/
│   ├── index.ts                    # Registry + StyleSpec system
│   ├── meepo.ts                    # Default form
│   └── xoblob.ts                   # Transform form
│
├── voice/
│   ├── state.ts                    # Connection state tracking
│   ├── connection.ts               # Voice lifecycle
│   ├── receiver.ts                 # Audio capture + STT
│   ├── speaker.ts                  # TTS output
│   ├── audioFx.ts                  # Optional audio effects
│   ├── voiceReply.ts               # Response pipeline
│   ├── wakeword.ts                 # Trigger detection
│   ├── stt/
│   │   ├── provider.ts             # STT interface
│   │   ├── openai.ts               # Whisper integration
│   │   └── normalize.ts            # Domain normalization
│   └── tts/
│       ├── provider.ts             # TTS interface
│       └── openai.ts               # gpt-4o-mini-tts integration
│
├── ledger/
│   ├── ledger.ts                   # Append-only queries
│   ├── transcripts.ts              # Unified transcript builder (Meecap + Events)
│   ├── meepo-mind.ts               # (future) Character retrieval
│   └── system.ts                   # System event helper
│
├── latch/
│   └── latch.ts                    # Conversation window state
│
├── sessions/
│   ├── sessions.ts                 # Session CRUD + helpers
│   └── meecap.ts                   # Meecap generation + validation
│
├── registry/
│   ├── loadRegistry.ts             # YAML loader
│   ├── types.ts                    # Type definitions
│   └── normalizeText.ts            # Regex normalization engine
│
├── llm/
│   ├── client.ts                   # OpenAI wrapper
│   └── prompts.ts                  # System prompt builder
│
├── commands/
│   ├── meepo.ts                    # /meepo subcommands
│   ├── session.ts                  # /session subcommands
│   ├── ping.ts                     # /ping
│   ├── deploy-dev.ts               # /deploy-dev
│   └── index.ts                    # Command registry
│
├── utils/
│   └── logger.ts                   # Centralized logging
│
└── tools/
    ├── compile-and-export-events.ts      # Event compilation
    ├── compile-and-export-events-batch.ts # Batch compiler
    ├── scan-names.ts                      # Name discovery
    ├── review-names.ts                    # Registry triage
    └── cleanup-canonical-aliases.ts       # Validation
```

---

## Common Workflows

### Test Voice Flow
```bash
LOG_LEVEL=debug LOG_SCOPES=voice npm run dev:bot
# Join voice channel, speak "meepo, hello"
# Watch transcription, LLM call, TTS response in logs
```

### Ingest Campaign Recording
```bash
npx tsx tools/ingest-media.ts \
  --mediaPath "C:\Recordings\C2E06.mp4" \
  --outDb "./data/bot.sqlite" \
  --sessionLabel "C2E06" \
  --maxMinutes 20
```

### Scan & Update Registry
```bash
# Find unknown names in ledger
npx tsx src/tools/scan-names.ts

# Interactively review candidates
npx tsx src/tools/review-names.ts

# Validate aliases
npx tsx src/tools/cleanup-canonical-aliases.ts
```

### Compile Session for Analysis
```bash
# Single session by label
npx tsx src/tools/compile-and-export-events.ts --session C2E06

# All labeled sessions
npx tsx src/tools/compile-and-export-events-batch.ts
```

### View Logs by Scope
```bash
# Voice only
LOG_SCOPES=voice npm run dev:bot

# Multiple scopes
LOG_SCOPES=voice,stt,llm npm run dev:bot

# Trace level
LOG_LEVEL=trace npm run dev:bot
```

---

## Design Principles (Sacred)

1. **Diegetic Primacy** — Meepo exists *inside* the world
2. **Strict Guardrails** — No hallucinated lore, ever
3. **Voice-First Narration** — Speech at the table is primary source
4. **Emotional Memory, Not Omniscience** — Meepo remembers *because* something mattered
5. **Graceful Degradation** — Log errors, don't crash; fallbacks everywhere
6. **Scoped Authority** — NPC Mind only sees what Meepo perceives

---

## Recent Changes (February 14, 2026)

### Transcript Consolidation Refactoring ✨
Consolidated duplicate transcript-building logic from Meecap and Events tools into a unified `buildTranscript()` utility:

**New Module:**
- `src/ledger/transcripts.ts` — Shared transcript builder
  - Single source of truth for ledger querying
  - Filters: `source IN ('text', 'voice', 'offline_ingest')` + optional `narrative_weight='primary'`
  - Always prefers normalized content (`content_norm` → fallback to raw)
  - Returns `TranscriptEntry[]` with stable `line_index`, `author_name`, `content`, `timestamp_ms`

**Updated Modules:**
- `src/sessions/meecap.ts`
  - `buildMeecapTranscript()` now calls unified builder
  - `generateMeecapNarrative()` refactored to use shared builder
  - `generateMeecapV1Json()` refactored to use shared builder
  - `buildBeatsJsonFromNarrative()` simplified (takes `lineCount` parameter)

- `src/tools/compile-and-export-events.ts`
  - `loadSessionTranscript()` now uses unified builder
  - Fixed potential bug: raw content normalization now guaranteed

- `src/commands/session.ts`
  - `/session meecap` command updated for new architecture

**Benefits:**
- ✅ Single source of truth for filtering logic
- ✅ Consistent content normalization across tools
- ✅ Fixed Events tool edge case (raw content not always normalized)
- ✅ Reduced maintenance burden
- ✅ Clear separation: filtering upstream, formatting downstream

**Migration Note:**
All existing Meecap narratives must be regenerated. Previous meecaps were built with the old transcript logic
and may have slight inconsistencies. Consider:
```sql
DELETE FROM meecaps;  -- Clear old narratives
```
Then run `/session meecap --all --force` to regenerate all labeled sessions.

---

## What's Next (Phase 3)

### Gravity-Driven Character Retrieval
- Assign gravity scores to Meecap beats (Costly Love, Tenderness, Moral Fracture)
- Build character impression index (which beats involve PC?)
- Implement memory retrieval: When PC speaks, fetch relevant high-gravity beats
- Inject into LLM response prompt as emotional context

### LLM Prompt Enhancement
- Dynamic PC name injection (from registry)
- Gravity-weighted beat context
- Shortened working set (recency + gravity)
- Guard against self-reference (Meepo's own replies)

### Testing & Refinement
- Gravity assignment validation
- Character retrieval latency (query optimization)
- LLM response quality vs context size trade-off
- User feedback loops

---

## Troubleshooting

### Bot won't start
- Check `LOG_LEVEL=debug npm run dev:bot`
- Verify `DISCORD_TOKEN` is set
- Check database file at `DATA_DB_PATH`

### Voice not transcribing
- Verify `STT_PROVIDER=openai` and `OPENAI_API_KEY` set
- Check `LOG_SCOPES=voice,stt` for transcription errors
- Adjust `VOICE_SILENCE_THRESHOLD_DB` (try -50 for less aggressive)

### Meecap failing
- Run `/session meecap --force` to regenerate with fresh logs
- Check database has ledger entries: `SELECT COUNT(*) FROM ledger_entries;`
- Verify registry is valid: `npx tsx src/tools/cleanup-canonical-aliases.ts`

### Recap missing
- Ensure Meecap exists: `/session meecap` first
- Use `--force_meecap` flag to regenerate: `/session recap --force_meecap`

---

## File Tree Reference

```
docs/
├── CURRENT_STATE.md                 ← You are here (unified current state)
├── Project_Meepo.md                 (strategic vision + philosophy)
├── HANDOFF.md                       (Feb 11 snapshot, archived)
├── HANDOFF_V0.md                    (V0 deep-dive, archived)
├── HANDOFF_MEEP_MVP.md              (sprint 1 phases, archived)
└── HANDOFF_MEECAP_FIXES.md          (Feb 13 incremental improvements, archived)

src/db/schema.sql                    (Canonical database schema)
```

---

## Questions or Clarifications?

- **Architecture**: See `Project_Meepo.md`
- **V0 Details**: See `HANDOFF_V0.md`
- **Logging Setup**: See `src/utils/logger.ts` code comments
- **Registry Format**: See `data/registry/*.yml` examples
- **Meecap Schema**: See `src/sessions/meecap.ts` type definitions

**Deprecated docs** (`HANDOFF*` files) remain for historical reference but should not be your primary source.
