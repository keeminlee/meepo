# Meepo Bot - Current State (February 15, 2026)

**Status:** V0 complete, MeepoMind (V0.1) Phase 2-3 in progress + NAL Copilot enhancements  
**Last Updated:** February 15, 2026

---

## Quick Start

```bash
npm run dev:bot        # Start bot with hot-reload
npm run dev:deploy     # Register/update slash commands in Discord
npx tsc --noEmit      # Type-check code
```

### Test in Discord

```
/meepo wake                              # Start session + auto-join General voice (STT enabled)
/session new --label C2E20               # Start new session with label (DM-only)
/meepo announce --dry_run true           # Preview session announcement (DM-only)
meepo: hello                             # Auto-latch responds
/session transcript range=since_start    # View all text+voice from session
/session meecap                          # Generate Meecap (4-8 scenes, 1-4 beats)
/session recap                           # DM summary (default: style=dm, source=primary)
/session recap style=narrative           # Meecap-structured prose with detail
/meepo join                              # Join your voice channel (STT auto-enabled)
<speak: "meepo, help me">               # STT → LLM → TTS closed loop
```

### OBS Overlay

```
http://localhost:7777/overlay            # Browser Source for speaking indicators
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
- **Auto-join Voice:** Meepo automatically joins General voice when waking (via `/meepo wake` or auto-wake)
- **STT Always-On:** STT automatically enabled when Meepo joins any voice channel

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
- **Meepo State Persistence:** Active state (`is_active=1`) persists across bot restarts; Meepo auto-restores and rejoins voice
- **Session Lifecycle:**
  - **Auto-start:** `/meepo wake` generates UUID session, auto-grouped text+voice
  - **Manual start:** `/session new [--label C2E20]` starts a new session (ends active session first)
  - **Auto-end:** `/meepo sleep` or inactivity timeout (`MEEPO_AUTO_SLEEP_MS`)
- **Session Announcements:** `/meepo announce [--dry_run] [--timestamp] [--label] [--message]` posts Discord reminders with auto-incremented labels
- **Labeling:** Optional user labels (e.g., "C2E06") for reference via `/session label`
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
- `/meepo wake|sleep|status|hush|transform|join|leave|stt|say` — Instance management
- `/meepo reply mode:voice|text` — Set response mode (voice TTS or text messages)
- `/meepo announce [--dry_run] [--timestamp] [--label] [--message]` — [DM-only] Post session reminder to announcement channel
- `/meepo set-speaker-mask user:@User mask:"Name"` — [DM-only] Set diegetic speaker name
- `/meepo clear-speaker-mask user:@User` — [DM-only] Remove speaker mask
- `/session new [--label C2E20]` — [DM-only] Start a new session (ends active session first)
- `/session label [label] [--session_id]` — [DM-only] Set label for session
- `/session view scope:all|unlabeled` — [DM-only] List sessions
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
- `src/tools/regenerate-meecap-beats.ts` — Regenerate beats table from existing narratives (no LLM)
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
  · reply_mode ('voice'|'text', default 'text') ← runtime reply mode control
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

-- Speaker Masks (diegetic name sanitization)
speaker_masks
  · guild_id, discord_user_id (composite PK)
  · speaker_mask (TEXT, e.g. 'Narrator', 'Dungeon Master')
  · created_at_ms, updated_at_ms
  · Prevents OOC Discord usernames from leaking into NPC context

-- Sessions (grouped ledger)
sessions
  · session_id (TEXT PRIMARY KEY, UUID) ← the invariant
  · guild_id, label (optional user metadata), source ('live'|'ingest-media')
  · started_at_ms, ended_at_ms
  · started_by_id, started_by_name
  · created_at_ms (immutable creation timestamp, used for "latest ingested" ordering)

-- Meecaps (derived artifact - dual storage)
meecaps
  · session_id (PK → sessions.session_id)
  · meecap_narrative (TEXT, generated prose + transcript)
  · model (model name, e.g. 'claude-opus')
  · created_at_ms, updated_at_ms

-- Meecap Beats (normalized beat rows from narrative)
meecap_beats
  · id (TEXT PK, UUID)
  · session_id (FK → meecaps.session_id, ON DELETE CASCADE)
  · label (TEXT, human-readable session label like "C2E6")
  · beat_index (INT, ordering within session)
  · beat_text (TEXT, narrative text of the beat)
  · line_refs (TEXT, JSON array of line numbers)
  · created_at_ms, updated_at_ms
  · UNIQUE(session_id, beat_index) for stable ordering

✅ Migration Note (Feb 14): meecap_json column removed. Label column added. All 19 C2E sessions backfilled (434 beats).

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
- Natural conversation (address-triggered, persistent in bound channel)
- Session tracking (auto-start on wake, UUID-based grouping, auto-sleep on inactivity)
- Ledger-first architecture (omniscient + voice-primary)
- Transcript + recap commands (DM-only, range filtering)
- Character registry (YAML, with name discovery tools)
- Meecap generation (scene/beat segmentation, ledger-anchored)
- Batch ingestion tools (offline media → session DB)
- **Unified Transcript Builder** (consolidated Meecap + Events logic) ✨
- **Speaker Mask System** (OOC name sanitization, DM commands, database-backed) ✨ **NEW Feb 14 Eve**
- **Runtime Reply Mode** (voice/text toggling without restart) ✨ **NEW Feb 14 Eve**
- **Auto-Sleep** (configurable inactivity timeout for graceful session cleanup) ✨ **NEW Feb 14 Eve**
- **Memory Recall Pipeline** (registry → events → GPTcap beats → memory capsules) ✨ **NEW Feb 14 Eve**
- **Incremental Memory Seeding** (title-based differential updates) ✨ **NEW Feb 14 Eve**
- **MeepoView Overlay** (OBS streaming overlay with real-time speaking indicators) ✨ **NEW Feb 15**
  - Shows/hides tokens based on Discord voiceStateUpdate (adaptive to who's in voice)
  - Dynamically loads tokens from pcs.yml registry (single source of truth)
  - Scaled 75% larger (140px tokens, 28px gaps) for better OBS visibility
  - WebSocket-based speaking & presence state with auto-reconnect
  - URL: `http://localhost:7777/overlay` (configure as OBS Browser Source)
- **Auto-Join Voice on Wake** (Meepo joins General voice channel automatically when waking) ✨ **NEW Feb 15**
- **STT Always-On** (STT enabled by default when joining voice, no manual toggle needed) ✨ **NEW Feb 15**
- **Adaptive Presence Tracking** (Overlay visibility tied to voice channel membership) ✨ **NEW Feb 15**
  - voiceStateUpdate handler tracks Discord member joins/leaves
  - Meepo presence tracked separately on join/leave/disconnect
  - Tokens hidden by default, shown only when users are voice-connected
  - No lingering states when users disconnect or bot leaves

### 🔄 Phase 2-3 (In Progress)
- ✅ **Beats Normalization:** Meecap beats now in dedicated table with label column (Feb 14)
- ✅ **Bootstrap Infrastructure:** generate-beats.ts tool and gptcaps filesystem structure (Feb 14)
- ⏳ **Gravity Scoring:** Post-session emotional weight assignment (Costly Love, Tenderness, Moral Fracture)
- ⏳ **Character-Scoped Retrieval:** Filter beats by PC involved, order by gravity
- ⏳ **Memory Integration:** Inject retrieved beats into LLM response prompts
- ⏳ **Gravity Columns:** Add gravity score columns to meecap_beats table
- ⏳ **Character Indexing:** Build efficient PC involvement queries on beats

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

# Session Management
MEEPO_AUTO_SLEEP_MS=1800000         # Auto-sleep after inactivity (ms). 0 = disabled
ANNOUNCEMENT_CHANNEL_ID=<id>        # Discord channel for /meepo announce reminders

# Overlay (OBS)
OVERLAY_PORT=7777                   # HTTP + WebSocket server port
OVERLAY_VOICE_CHANNEL_ID=<id>      # Auto-join on bot startup (speaking detection)
MEEPO_HOME_VOICE_CHANNEL_ID=<id>   # Auto-join when Meepo wakes/restores

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
│   ├── nickname.ts                 # Discord nickname management
│   ├── knowledge.ts                # Foundational memories (INITIAL_MEMORIES)
│   ├── autoSleep.ts                # Inactivity-based session cleanup
│   └── autoJoinVoice.ts            # Auto-join General voice on wake
│
├── personas/
│   ├── index.ts                    # Registry + StyleSpec system
│   ├── meepo.ts                    # Default form
│   └── xoblob.ts                   # Transform form
│
├── overlay/
│   ├── server.ts                   # HTTP + WebSocket server for OBS overlay
│   └── speakingState.ts            # Debounced speaking state management
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
│   ├── speakerSanitizer.ts         # OOC name sanitization (speaker masks)
│   ├── eventSearch.ts              # Event querying by character/location
│   ├── gptcapProvider.ts           # GPTcap loading from filesystem
│   ├── meepo-mind.ts               # Character retrieval + memory seeding
│   └── system.ts                   # System event helper
│
├── latch/
│   └── latch.ts                    # Conversation window state
│
├── sessions/
│   ├── sessions.ts                 # Session CRUD + helpers
│   └── meecap.ts                   # Meecap generation + validation
│
├── ├── normalizeText.ts            # Regex normalization engine
│   └── extractRegistryMatches.ts   # Entity extraction from text

├── recall/
│   ├── findRelevantBeats.ts        # Beat relevance scoring
│   └── buildMemoryContext.ts       # Memory capsule formatter (with WITNESS POSTURE)
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
    ├── generate-beats.ts                 # Beats generation (meecaps ↔ gptcaps)
    ├── regenerate-meecap-beats.ts        # Beats table regeneration
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

## Recent Changes (February 14, 2026 - Evening)

### NAL Copilot: Diegetic Integrity & Runtime Configuration ✨
Final polish for V0.1 release focusing on immersion preservation and dynamic configuration:

**Speaker Mask System (OOC Name Firewall):**
- **Problem:** Meepo was using Discord usernames (e.g., "Keemin (DM)") in responses, breaking diegetic immersion
- **Solution:** Per-guild speaker mask database with priority sanitization
  - New `speaker_masks` table with guild+user composite key
  - DM-only commands: `/meepo set-speaker-mask`, `/meepo clear-speaker-mask`
  - `src/ledger/speakerSanitizer.ts` — Centralized sanitization with fallback chain:
    1. Check speaker_masks table first
    2. Fall back to registry (future enhancement)
    3. Default to "Party Member" if no mask found
  - Integrated into all context building: `getVoiceAwareContext()`, `respondToVoiceUtterance()`, text message handlers
  - Persona enhancement: Added OOC NAME FIREWALL to Meepo's styleGuard
    - "Never refer to or address speaker labels like 'Party Member', 'Narrator', 'Dungeon Master', or Discord usernames"

**Reply Mode Migration (Env Var → Runtime Command):**
- **Deprecated:** `MEEPO_VOICE_REPLY_ENABLED` environment variable
- **New:** `/meepo reply mode:voice|text` command for runtime control
  - Added `reply_mode` column to `npc_instances` table (default: 'text')
  - Updated `MeepoInstance` type and `wakeMeepo()` to track mode
  - Modified `voiceReply.ts` and `/meepo say` to check database instead of env var
  - Database migration auto-applies on bot restart
  - Benefits: No restart needed to switch modes, per-instance configuration

**Auto-Sleep Feature:**
- **Problem:** Orphaned sessions when forgetting `/meepo sleep` before stopping bot
- **Solution:** Background inactivity checker with configurable timeout
  - New module: `src/meepo/autoSleep.ts`
    - Runs check every 60 seconds
    - Queries latest ledger timestamp per guild
    - Calls `sleepMeepo()` when inactivity exceeds threshold
  - Configuration: `MEEPO_AUTO_SLEEP_MS` in .env (default: 600000ms / 10 minutes)
  - Set to `0` to disable
  - Integrated into bot startup (`client.once("ready")`)
  - Logs auto-sleep events to console

**Persistent Channel Uptime:**
- **Removed:** Latch mechanism entirely
- **New behavior:**
  - Meepo responds to ALL messages in bound channel (no latch expiry)
  - Requires @mention in other channels
  - Cleaner UX for dedicated #meepo channels
  - Simplified codebase (removed latch imports/checks from bot.ts)

**Memory System Enhancements:**
- **Moved:** `INITIAL_MEMORIES` from `meepo-mind.ts` → `src/meepo/knowledge.ts`
  - Better separation of concerns (knowledge definition vs DB operations)
  - Shared `Memory` type for consistency
- **Fixed:** Memory seeding changed from one-time to incremental
  - Previously: Only seeded if table completely empty
  - Now: Title-based differential seeding
    - Query existing titles from DB
    - Filter `INITIAL_MEMORIES` to only missing titles
    - Insert only new memories
  - Benefits: Can add new memories to `knowledge.ts` without wiping database

**Recall Pipeline Enhancement:**
- **Added:** WITNESS POSTURE guidance to memory capsule injection
  - Appended to `buildMemoryContext()` output in `src/recall/buildMemoryContext.ts`
  - Instructs Meepo on pre vs post-embodiment perspective
  - Emphasizes uncertainty admission and shared party viewpoint
  - Applied to both text and voice recall contexts

**Context Inclusivity:**
- **Fixed:** `getVoiceAwareContext()` now includes `secondary` narrative weight
  - Previously excluded secondary text messages
  - Caused conversation continuity breaks in text chat
  - Now includes: 'primary', 'elevated', 'secondary'

**New Modules:**
- `src/ledger/speakerSanitizer.ts` — OOC name sanitization
- `src/meepo/knowledge.ts` — Meepo's foundational memories
- `src/meepo/autoSleep.ts` — Inactivity-based session cleanup

**Schema Changes:**
- `speaker_masks` table (guild_id, discord_user_id, speaker_mask, timestamps)
- `npc_instances.reply_mode` column (TEXT NOT NULL DEFAULT 'text')
- Both migrations auto-apply on bot restart

**Configuration Changes:**
- `MEEPO_AUTO_SLEEP_MS=600000` added to .env (default 10 minutes)
- `MEEPO_VOICE_REPLY_ENABLED` commented out with deprecation note

---

## Recent Changes (February 14, 2026 - Afternoon)

### Bootstrap Infrastructure & Beats Normalization ✨
Prepared modularity for GPU-enhanced meecaps (gptcaps) bootstrapping by establishing parallel filesystem storage for experimental narratives and beats:

**New Tool:**
- `src/tools/generate-beats.ts` — Unified beats generation for meecaps and gptcaps
  - Supports `--source meecaps|gptcaps` for flexible bootstrap/canonical use
  - For meecaps: reads from filesystem, looks up UUID session_id in DB, inserts beats
  - For gptcaps: pure filesystem mode (no DB dependency, allows offline workflows)
  - Flags: `--db` (insert to meecap_beats), `--force` (overwrite), `--session` (filter by label)
  - Output: `beats_{label}.json` files with self-documenting label field
  - Enhanced logging: NAMING DRIFT detection for filename mismatches

**Schema Enhancements:**
- Added `label TEXT` column to meecap_beats
  - Enables human-readable querying without joins to sessions table
  - Auto-created and backfilled on bot startup
- Updated FK constraint: Added `ON DELETE CASCADE` for safety
  - Prevents orphaned beats if a meecap narrative is deleted

**Type/Storage Updates:**
- `MeecapBeats` type now includes optional `label?: string` field
  - Makes beats self-contained (no need to parse filename for label)
  - Consistent with filesystem naming (both use label)
- `buildBeatsJsonFromNarrative()` now accepts label parameter
  - Label automatically stored in beats JSON output

**Filesystem Restructuring:**
- Renamed all beats files from UUID-based to label-based: `{uuid}.json` → `beats_{label}.json`
  - All 19 C2E sessions now human-readable: `beats_C2E1.json` through `beats_C2E19.json`
  - Regenerated with `generate-beats.ts --source meecaps --db --force` (434 beats total)
- Directory structure now mirrors meecaps naming:
  ```
  data/meecaps/narratives/meecap_C2E6.md
  data/meecaps/beats/beats_C2E6.json
  data/gptcaps/narratives/meecap_C2E6.md    ← future: from ChatGPT
  data/gptcaps/beats/beats_C2E6.json        ← future: derived from gptcap
  ```

**Database Backfill:**
- All 434 beats now have label column populated from sessions table
- Verified: 19 sessions with beat counts: C2E1(24), C2E2(32), ..., C2E19(26)
- Safe, idempotent: can regenerate with --force flag anytime

**Benefits for Bootstrap:**
- Meecaps storage: filesystem-first modularity (can work offline)
- Gptcaps isolation: DB-free, completely separate from canonical data
- Easy promotion: gptcap → meecap is just a filesystem copy + DB insert
- Label consistency: narratives and beats both use same naming convention

**Directory Refactoring:**
- Renamed `data/session-events` → `data/events` (parity with other data dirs)
- Updated 3 references in `compile-and-export-events.ts`

## Recent Changes (February 14, 2026 - Morning)

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

### Meecap Beats Table Migration ✨ **NEW Feb 14**
Restructured meecap storage to support dual-lane Silver architecture (Meecaps + Events as two independent ways to understand sessions):

**Schema Changes:**
- **New `meecap_beats` table** (normalized beat rows)
  - Columns: `id, session_id, beat_index, beat_text, line_refs, created_at_ms, updated_at_ms`
  - One row per beat with stable ordering (UNIQUE on session_id, beat_index)
  - Enables efficient querying for character involvement, gravity scoring, etc.
  - Index on session_id for fast lookups by session

- **Removed `meecap_json` column** from meecaps table
  - Never actually used (was phantom infrastructure for "work already done?" checks)
  - Logic preserved but now hits meecap_beats table instead

**Code Changes:**
- `buildBeatsJsonFromNarrative()` enhanced with `insertToDB` parameter
  - When true, persists beats to meecap_beats table (idempotent, deletes old beats first)
  - Maintains backward compatibility for non-DB usage
  
- `src/commands/session.ts` refactored
  - All `meecap_json` column checks → `meecap_beats` table queries
  - Batch generation now filters on beats existence (not JSON column)
  - Narrative and beats generation now happen in separate steps (clean separation)

**Architecture:**
- **Meecaps = dual product** for humans + machines
  - Narrative: Source of truth, persisted in DB + filesystem (`data/meecaps/narrative/`)
  - Beats: Derived artifact, normalized in DB table + filesystem (`data/meecaps/beats/`)
  - Beats are deterministically extracted from narrative (no LLM cost, regenerable)

- **Why this structure?**
  - Humans read narrative prose (beautiful, coherent, discoverable in Discord)
  - Machines query beats table (efficient filtering for Gold layer future work)
  - Narrative never deleted/moved (beats depend on it)
  - Beats independently queryable (character involvement? beat pagination? gravity? all doable)

**Migration Path:**
- Database migration auto-creates meecap_beats table on bot startup
- Existing narratives preserved; beats need regeneration via:
  - `/session meecap --all` (generates both narrative + beats for missing sessions)
  - `regenerate-meecap-beats.ts` tool (regenerates just beats from existing narratives)
- No data loss; safe rollback possible

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
