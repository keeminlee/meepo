# Meepo Bot - Developer Handoff (MeepoMind Era)
**Date:** February 11, 2026  
**Status:** V0 Complete, MeepoMind (V0.1) In Development  
**Focus:** Character-centric memory and emotional continuity

---

## Quick Start

```bash
npm run dev:bot        # Start bot with hot-reload
npm run dev:deploy     # Register/update slash commands
npx tsc --noEmit      # Type-check
```

**Test in Discord:**
```
/meepo wake                              # Start session (auto-generates UUID)
meepo: hello                             # Auto-latch responds
/session transcript range=since_start    # View all text+voice from this session
/session meecap                          # Generate Meecap (4-8 scenes, 1-4 beats)
/session recap range=since_start         # DM summary (default: style=dm, source=primary)
/session recap range=since_start style=narrative  # Meecap-structured prose with detail
/session recap range=since_start --force_meecap  # Regenerate Meecap first, then recap
/meepo join                              # Enter voice channel
/meepo stt on                            # Enable transcription
<speak: "meepo, help me">               # STT → LLM → TTS closed loop
/session recap range=recording           # Recap latest ingested offline session
```

---

## Architecture Overview

### Core Concept
Meepo is a diegetic NPC for D&D sessions:
- **NOT** a rules engine, DM assistant, or omniscient narrator
- **IS** a witness, embodied presence, narrative continuity anchor
- Exists inside the world with strict guardrails (no hallucinated lore)

### Dual Knowledge System
1. **Omniscient Ledger** - Append-only log of ALL messages (for DM tools, recaps)
2. **NPC Mind** (future) - Scoped memory shaped by character and what Meepo perceives

**Current State:** Ledger fully implemented. NPC Mind deferred to MeepoMind phase.

### Key Data Flow
```
Discord Message/Voice → Ledger Entry → Session Recap / NPC Mind Retrieval
                          ↓
                    Narrative Weight (filter)
                   primary|secondary|elevated
                          ↓
                      (in MeepoMind)
                      Meecap → Beats → Gravity Score
                                ↓
                        Character Retrieval
```

---

## Recent Architecture Improvements (Feb 11)

### Session ID Invariant + Session Grouping
- **Problem Fixed:** Session IDs were user input → collision risk on re-ingestion
- **Solution:** Session ID now **generated as UUID** (immutable invariant)
  - User label stored as `sessions.label` (metadata only)
  - All ledger entries reference session via UUID
  - `created_at_ms` column added for deterministic "latest ingested" ordering
- **Impact:** Ledger can be queried by session (enables Meecap to operate on session scope)

### Live Session Recording
- **Text messages:** Now tagged with active `session_id` (when within a session)
- **Voice entries:** Already tagged with `session_id`
- **Result:** Both text and voice grouped consistently by session UUID
- **Use case:** Future Meecap queries can operate on any session (live or ingested)

### Ingestion Tool Alignment
- Schema updated to match main bot schema (including `created_at_ms`, `source` columns)
- Generates UUID for each ingestion session (no collision on re-ingest)
- Deterministic "latest" selection via `created_at_ms` ordering

---

## Recent Command Architecture Updates (Feb 11)

### Meecap Promoted to First-Class Command
**Before (Stub):**
- `/session recap mode=meecap` - Generated stub + persisted
- **Problem:** Recap and Meecap generation conflated in single UX
  
**After (Proper separation of concerns):**
- `/session meecap [--force] [--source primary|full]` - Generate/regenerate Meecap
- `/session recap [style] [source] [--force_meecap]` - Consume Meecap (or regenerate if needed)

**Philosophy:** Ledger (immutable) → Meecap (regenerable derived artifact) → Recap (view over Meecap)

### Recap Command Refactored
**Before:**
- `/session recap range=... mode=[primary|full|meecap]`
- **Problem:** `mode` conflated two concerns (ledger filtering + output format)

**After:**
```
/session recap range=...
           [style=dm|narrative|party]      # Output format
           [source=primary|full]            # Ledger filtering
           [--force_meecap]                 # Regenerate Meecap first
```

**Options explained:**
- **style:** Controls recap prose structure
  - `dm` - Structured sections (overview, beats, NPCs, etc.)
  - `narrative` - **NEW** — Scene headings from Meecap, prose from transcript
  - `party` - Party-focused recap
- **source:** Controls which ledger entries to include
  - `primary` - Voice + elevated text only (narrative-primary)
  - `full` - All entries including secondary chatter
- **--force_meecap:** If set, regenerates Meecap before rendering (ensures fresh structure)

**UX benefit:**
- Clearer mental model: Ledger filtering is separate from output formatting
- Narrative style enables prose recap with structural guidance from Meecap
- `--force_meecap` convenience flag for "update everything" workflow

---



### Systems
- ✅ Text + Voice I/O (STT+LLM+TTS closed loop)
- ✅ Persona system (meepo, xoblob with StyleSpec)
- ✅ Omniscient ledger with narrative authority tiers + session grouping
- ✅ Session tracking (UUID-based, auto-start on wake, auto-end on sleep)
- ✅ Transcript + recap commands (DM-only, supports recording range)
- ✅ Recording range support (query offline ingested sessions by `range=recording`)
- ✅ Live session tracking (text + voice entries tagged with session_id)
- ✅ Command infrastructure (slash commands, error handling)
- ✅ Anti-noise gating + STT domain normalization
- ✅ Feedback loop protection (Meepo doesn't transcribe itself)
- ✅ PID lock (prevents multiple bot instances)

### Database Schema
```sql
npc_instances
  - id, guild_id, name, form_id, persona_seed
  - created_at_ms, is_active

ledger_entries
  - id, guild_id, channel_id, message_id
  - author_id, author_name, timestamp_ms, content
  - session_id (UUID, tracks which D&D session this entry belongs to)
  - source (text|voice|system)
  - narrative_weight (primary|secondary|elevated)
  - speaker_id, audio_chunk_path, t_start_ms, t_end_ms, confidence

sessions
  - session_id (TEXT PRIMARY KEY) - Generated UUID (the invariant)
  - guild_id, label (user metadata, e.g., "C2E03")
  - created_at_ms (immutable creation timestamp, used for "latest ingested" ordering)
  - started_at_ms, ended_at_ms
  - source ('live' | 'ingest-media')

latches
  - key, guild_id, channel_id, expires_at_ms
```

**Important:** All migrations auto-apply on startup. Old databases get safe defaults.

**Session Architecture (Feb 11):**
- `session_id` is always a **generated UUID** (immutable, collision-resistant)
- `label` is optional user metadata for reference (e.g., "C2E03")
- `created_at_ms` is the immutable creation timestamp (used for deterministic "latest ingested" selection)
- All ledger entries reference session via `session_id` UUID
- Both text and voice entries populate `session_id` when within an active session

---

## MeepoMind Roadmap (V0.1)

### Objective
Give Meepo character-centric, emotionally weighted long-term memory shaped by:
- People and relationships
- Love and self-sacrifice
- Casualties and moral fracture

### Five-Layer Foundation

**Layer 1 — Ledger** ✅ Done
- Append-only omniscient history
- Voice-primary, narrative weight filters

**Layer 2 — Character Registry** ✅ Done (Phase 1A)
- YAML: Canonical names, aliases, Discord ID mapping
- Human-curated source of truth
- Used for STT normalization, clean recaps, beat participant assignment

**Layer 3 — Name Discovery Tool** ✅ Done (Phase 1B)
- Offline: Scans ledger for proper names
- Proposes new entries for registry review
- Virtuous feedback loop: Ledger → Scanner → Registry → Better STT → Better Recaps

**Layer 4 — Meecap** 🔄 Phase 2 (Stub Wired)
- Post-session structured segmentation
- Extracts scenes → beats (primary emotional memory unit)
- Assigns gravity scores (Tier 1: Costly Love, Tier 2: Tenderness, Tier 3: Moral Fracture)
- Participants + tags
- **Current State:** Stub generator wired, ready for LLM prompt implementation

**Layer 5 — Character-Scoped Memory Retrieval** ⏳ Phase 3
- When PC speaks: Retrieve beats involving that character
- Ordered by gravity (emotional relevance to Meepo)
- Limited working set (recent + high-gravity long-term)
- Injected into LLM prompt for responses

### Critical Design: Gravity vs Narrative Weight

**`narrative_weight`** (Ledger-level filtering)
- `primary`: Voice transcripts, system events (Meepo state changes), elevated text
- `secondary`: Text chatter, operational noise (voice toggles, joins)
- `elevated`: Text marked important by DM (future: `/mark-important`)
- **Purpose**: Filter crud, establish voice-first semantics
- **When**: Assigned at ledger append time

**`gravity`** (Beat-level, computed during Meecap)
- Tier 1: Costly Love (sacrifice, mercy, protection)
- Tier 2: Tenderness (comfort, forgiveness, vulnerability)
- Tier 3: Moral Fracture (cruelty, betrayal)
- **Purpose**: Retrieval ordering, memory pruning, embodied reactions
- **When**: Assigned post-session via LLM beat analysis

**They are orthogonal:**
- Start with primary narrative weight ledger entries
- Meecap extracts beats and scores gravity
- Character retrieval uses gravity to order which beats matter most

---

## Logging System (Feb 11 Cleanup)

### New Centralized Logger
```bash
src/utils/logger.ts
```

**Levels:** `error|warn|info|debug|trace`  
**Scopes:** `voice,stt,tts,ledger,llm,db,session,boot,meepo` (extensible)

### Configuration
```env
LOG_LEVEL=info                    # Default: info
LOG_SCOPES=                       # Optional: comma-separated (empty = all)
LOG_FORMAT=pretty                 # pretty|json
```

### Backward Compatibility
```env
DEBUG_VOICE=true  # Deprecated ⚠️
# Maps to: LOG_LEVEL=debug + LOG_SCOPES includes "voice"
# Emits one-time deprecation warning
```

### Usage in Code
```typescript
import { log } from "../utils/logger.js";

const voiceLog = log.withScope("voice");
voiceLog.info("started transcription");
voiceLog.debug("gated utterance", { reason: "too_quiet" });
voiceLog.error("STT failed", { err });
```

### Log Level Conventions
- **`info`** = Operational lifecycle (started/joined/stopped)
- **`debug`** = Debug details (preconditions, filters, quiet behaviors)
- **`warn`** = Recoverable but notable (fallbacks, missing data)
- **`error`** = Failures (API errors, DB errors)
- **`trace`** = Spammy internals (reserved for future detailed logging)

**Migration Strategy:** Opportunistically migrate as you touch modules. Receiver.ts done as proof-of-concept.

---

## Module Map

### Core
- `src/bot.ts` - Discord event loop, message handling, auto-wake
- `src/db.ts` - SQLite singleton, migrations
- `src/pidlock.ts` - Single-instance lock file

### Meepo State
- `src/meepo/state.ts` - NPC instance CRUD (wake/sleep/transform)
- `src/meepo/triggers.ts` - Address detection (prefix/mention)
- `src/meepo/nickname.ts` - Discord nickname management

### Personas
- `src/personas/index.ts` - Persona registry, StyleSpec system
- `src/personas/meepo.ts` - Default form (baby celestial, meep suffix)
- `src/personas/xoblob.ts` - Transform form (Entity-13V mimic, riddles)

### Voice Pipeline
- `src/voice/state.ts` - Voice state tracking per guild
- `src/voice/connection.ts` - Voice connection lifecycle
- `src/voice/receiver.ts` - Audio capture, gating, STT integration
- `src/voice/speaker.ts` - TTS playback queue
- `src/voice/wakeword.ts` - Address detection in voice
- `src/voice/voiceReply.ts` - STT → LLM → TTS closed loop

### STT/TTS Providers
- `src/voice/stt/provider.ts` - STT interface (noop|debug|openai)
- `src/voice/stt/openai.ts` - OpenAI Whisper integration
- `src/voice/stt/normalize.ts` - Domain name canonicalization (regex)
- `src/voice/stt/wav.ts` - PCM to WAV encoder
- `src/voice/tts/provider.ts` - TTS interface (noop|openai)
- `src/voice/tts/openai.ts` - OpenAI TTS with sentence chunking
- `src/voice/audioFx.ts` - Post-TTS pitch + reverb effects

### Ledger & Memory
- `src/ledger/ledger.ts` - Append-only log + queries (includes content_norm dual-column support)
- `src/ledger/system.ts` - System event logging helper
- `src/sessions/sessions.ts` - Session tracking (UUID-based, auto-start on wake)
- `src/sessions/meecap.ts` - **Meecap V1 generator (530 lines)**
  - Types: LineSpan, LedgerIdRange, MeecapBeat, MeecapScene, Meecap
  - Functions: generateMeecapStub(), buildMeecapTranscript(), validateMeecapV1(), buildMeecapPrompts()
  - Output: Structured JSON with scenes → beats, ledger ID ranges, evidence citations
  - Validation: Schema conformance + ledger ID existence checking

### Character Registry (Phase 1)
- `src/registry/loadRegistry.ts` - Multi-file YAML loader + collision detection
- `src/registry/types.ts` - Type system (Character, Location, Faction, Entity)
- `src/registry/normalizeText.ts` - Text normalization engine (Phase 1C)
- `data/registry/` - YAML source files (pcs.yml, npcs.yml, locations.yml, factions.yml, ignore.yml, decisions.pending.yml)

### LLM
- `src/llm/client.ts` - OpenAI wrapper with kill switch
- `src/llm/prompts.ts` - Prompt builder (persona-driven)

### Commands
- `src/commands/meepo.ts` - All Meepo control commands
- `src/commands/session.ts` - Transcript + recap (DM-only)
- `src/commands/index.ts` - Command registry + error handler
- `src/commands/deploy-dev.ts` - Guild command registration

### Utils
- `src/utils/logger.ts` - Centralized logging (**NEW**)

### Tools (Offline/Dev-Only)
- `tools/ingest-media.ts` - Offline media ingestion for test data generation (**Sprint -1**)
- `src/tools/scan-names.ts` - Offline ledger scanner + registry proposer (Phase 1B)
- `src/tools/review-names.ts` - Interactive CLI triager for pending registry entries (Phase 1B)
- `src/tools/test-normalize.ts` - Unit tests for normalizeText() (Phase 1C validation)
- `src/tools/test-wakeword-norm.ts` - Wakeword robustness tests (Phase 1C validation)

---

## Environment Variables Reference

### Discord
```env
DISCORD_TOKEN=sk-...
DISCORD_CLIENT_ID=...
GUILD_ID=...                 # Guild-only during dev
```

### Bot Behavior
```env
BOT_PREFIX=meepo:
LATCH_SECONDS=90
```

### Database
```env
DB_PATH=./data/bot.sqlite
```

### LLM
```env
OPENAI_API_KEY=sk-proj-...
LLM_ENABLED=true
LLM_MODEL=gpt-4o-mini
LLM_TEMPERATURE=0.3
LLM_MAX_TOKENS=200
LLM_VOICE_CONTEXT_MS=120000   # Voice context window
```

### STT (Phase 3 - Live)
```env
STT_PROVIDER=openai|noop|debug
STT_OPENAI_MODEL=gpt-4o-mini-transcribe
STT_LANGUAGE=en
STT_NORMALIZE_NAMES=true
STT_SAVE_AUDIO=false           # Debug: save WAV files
```

### TTS (Phase 4 - Live)
```env
TTS_ENABLED=true
TTS_PROVIDER=openai|noop
TTS_VOICE=alloy
TTS_MAX_CHARS_PER_CHUNK=350
TTS_OPENAI_MODEL=gpt-4o-mini-tts
```

### Voice Timing
```env
VOICE_REPLY_COOLDOWN_MS=5000
```

### Audio FX (Optional)
```env
AUDIO_FX_ENABLED=false
AUDIO_FX_PITCH=1.0             # 1.0 = no shift
AUDIO_FX_REVERB=false
AUDIO_FX_REVERB_WET=0.3
AUDIO_FX_REVERB_DELAY_MS=20
AUDIO_FX_REVERB_DECAY=0.4
```

### Logging (Feb 11 - NEW)
```env
LOG_LEVEL=info                 # error|warn|info|debug|trace
LOG_SCOPES=                    # voice,stt,tts,ledger,llm,db,session,boot,meepo
LOG_FORMAT=pretty              # pretty|json
```

### Permissions
```env
DM_ROLE_ID=...                 # Role ID for DM-only commands
```

---

## Common Workflows

### Add a New Voice Scope to Logger
```typescript
// In src/utils/logger.ts, add to type LogScope:
export type LogScope = "voice" | "stt" | "myfeature" | ... string;

// Use in code:
const myLog = log.withScope("myfeature");
myLog.info("message");
myLog.debug("details", { data: value });
```

### Start a New Module (with logging)
```typescript
import { log } from "../utils/logger.js";

const myLog = log.withScope("mymodule");

export function doThing() {
  myLog.info("Starting thing");
  try {
    // ...
    myLog.debug("subtask complete");
  } catch (err) {
    myLog.error("Thing failed", { err });
  }
}
```

### Test with Logging
```bash
# See all logs (default)
npm run dev:bot

# See only voice/stt logs
LOG_SCOPES=voice,stt npm run dev:bot

# See trace-level details for everything
LOG_LEVEL=trace npm run dev:bot

# JSON format for parsing
LOG_FORMAT=json npm run dev:bot
```

### Ingest Test Data (Sprint -1)
Generate a test ledger database from campaign recordings:

```bash
# Ingest 2 minutes for quick testing
npx tsx tools/ingest-media.ts \
  --mediaPath "G:\Campaign 2\recording.mp4" \
  --outDb "./data/test_ingest.sqlite" \
  --sessionLabel "C2E03" \
  --maxMinutes 2 \
  --overwrite

# Full 15-20 minute ingestion for Phase 1 development
npx tsx tools/ingest-media.ts \
  --mediaPath "G:\Campaign 2\recording.mp4" \
  --outDb "./data/test_ingest.sqlite" \
  --sessionLabel "C2E03" \
  --maxMinutes 20 \
  --overwrite
```

**Tool Features:**
- Extracts audio via FFmpeg → 16kHz mono PCM
- Chunks into configurable segments (default 60s)
- Transcribes via OpenAI Whisper (reuses STT provider)
- Writes ledger entries with synthetic IDs (`guild_id="offline_test"`)
- Creates session record (enables `/session recap` on test data)
- Outputs `out/segments_<sessionLabel>.jsonl` for debugging

**Query Test Data:**
```powershell
# Preview transcripts
sqlite3 .\data\test_ingest.sqlite "SELECT substr(content, 1, 200) FROM ledger_entries LIMIT 10;"

# Count entries
sqlite3 .\data\test_ingest.sqlite "SELECT COUNT(*) FROM ledger_entries;"

# Check session metadata + UUID
sqlite3 .\data\test_ingest.sqlite "SELECT session_id, label, source, created_at_ms FROM sessions;"

# Verify entries are grouped by session_id
sqlite3 .\data\test_ingest.sqlite "SELECT session_id, COUNT(*) as entry_count FROM ledger_entries GROUP BY session_id;"
```

---

## MeepoMind Dev Entry Points

### Latest: Meecap V1 + Command Refactoring ✅ Complete (Feb 11)

**Sprint Summary:** Promoted Meecap V1 to first-class command and refactored recap to consume it as a derived view.

#### Task 1: `/session meecap` Command ✅
- New first-class subcommand with `--force` and `--source` options
- Resolves most recent session (prefers ingested, falls back to active)
- Generates Meecap with validated schema (4-8 scenes, 1-4 beats)
- Validates pre-persistence using `validateMeecapV1()`
- Persists to SQLite with UPSERT (regenerable, overwrites on conflict)
- Exports to disk (`data/meecaps/{session_id}__{timestamp}.json` + `latest.json`)
- Attaches JSON to Discord for manual review/editing

**Design Philosophy:**
- Ledger = immutable source of truth
- Meecap = regenerable derived artifact (not sacred, can be overwritten)
- Recap = view over Meecap (consumes, doesn't generate)

#### Task 2: `/session recap` Refactored ✅
- **Old mode=meecap behavior:** Generated fresh Meecap each time ❌
- **New behavior:** Loads existing Meecap from database ✅
- Falls back gracefully: "Run `/session meecap` first"
- If Meecap missing but `--force_meecap` flag set: regenerate on-demand
- Makes Meecap the source of truth, recap the consumer

#### Task 3: `style=narrative` Recap Type ✅
- **Replaced option:** `mode` → `style` + `source` (separate concerns)
- **Style options:**
  - `dm` (default): Structured DM summary with sections (overview, beats, NPCs, decisions, conflicts, loot, threads)
  - `narrative`: **NEW** — Meecap-structured prose (scenes as headings) with transcript detail
  - `party`: Party-focused recap
- **Source options:**
  - `primary`: Voice-focused entries only
  - `full`: All ledger entries
- **Narrative generation:** LLM call with meecap structure + transcript, produces 800-1500 word prose

#### Task 4: Token/Length Guardrails ✅
- **DM/Party recap:** `maxTokens: 3000` (~1500 words max)
- **Narrative recap:** `maxTokens: 2500` (~1500 words max)
- **Meecap generation:** `maxTokens: 16000` (unchanged, allows detailed segmentation)
- **System prompts updated:** Added "TARGET: 800-1500 words" guidance
- All LLM calls now have explicit token bounds (prevents runaway generations)

#### Task 5: `--force_meecap` Convenience Flag ✅
- New boolean option: `/session recap [style=narrative] --force_meecap`
- When set: regenerates Meecap before rendering recap
- Validates fresh Meecap, persists it, then proceeds with narrative rendering
- Graceful error handling if regeneration fails
- Helpful message suggests `--force_meecap` when Meecap not found

**Current Command State:**
```
/session meecap [--force] [--source primary|full]
  ↓ (validates + persists)
/session recap [range] [style=dm|narrative|party] [source=primary|full] [--force_meecap]
```

**Validation:**
- ✅ TypeScript: `npx tsc --noEmit` clean
- ✅ Discord validation: All option descriptions ≤100 chars
- ✅ Bot startup: No errors, all commands registered
- ✅ UPSERT pattern: Correct MVÏ behavior (regenerable Meecap)

---

### Session Architecture + Recording Range ✅ Complete (Feb 11)

**What was fixed:**
- Session ID now generated as UUID (from `startSession()` and ingestion tool)
- User label stored in `sessions.label` (metadata, not primary key)
- All ledger entries reference session via UUID `session_id`
- Added `created_at_ms` column for deterministic "latest ingested" ordering
- Text messages now populate `session_id` when in active session
- Voice entries already populated `session_id` (now consistently grouped)
- `/session recap range=recording` and `/session transcript range=recording` working
  - Selects latest ingested session via `created_at_ms DESC` ordering
  - Queries ledger by session UUID (no time-window ambiguity)
  - Guild-scoped with fallback for offline testing

**Key validations:**
- ✅ TypeScript compilation clean
- ✅ Migrations auto-apply (created_at_ms backfilled from started_at_ms)

### Identity Model Clarification + Label Filtering ✅ Complete (Feb 11)

**Problem Solved:**  
"one meecap per session" looked ambiguous when users might ingest "C2E01" multiple times (retries, edits, partial runs).

**Solution:**  
- `session_id` = **UUID generated per ingest/run** (unique, immutable invariant)
- `label` = user-provided episode label like "C2E01" (metadata, NOT unique; multiple runs can share)
- Deterministic "latest session" relies on `created_at_ms` (immutable creation timestamp)

**Implementation:**
- ✅ Added identity model comments in [schema.sql](src/db/schema.sql#L62-L70) and [ingest-media.ts](tools/ingest-media.ts#L530-L533)
- ✅ Added `getLatestSessionForLabel(label)` helper in [sessions.ts](src/sessions/sessions.ts#L92-L100)
- ✅ Respect label filter in `getLedgerSlice()` for "recording" range [session.ts](src/commands/session.ts#L14-L63)

**UX Improvement: `--label` Option**  
Both commands now accept optional `--label` to select "latest session for this episode":

```
/session meecap --label C2E01
/session recap range=recording --label C2E01 style=narrative
```

If omitted, defaults to "latest ingested overall" (current behavior).

**Acceptance Test:**  
Ingest twice with same label into same DB (no wipe):
```bash
npx tsx tools/ingest-media.ts --mediaPath <file> --outDb <db> --sessionLabel C2E01
npx tsx tools/ingest-media.ts --mediaPath <file> --outDb <db> --sessionLabel C2E01
```

Verify both sessions exist with different UUIDs:
```sql
SELECT session_id, label, created_at_ms FROM sessions WHERE label='C2E01' ORDER BY created_at_ms DESC;
-- Expected: 2 rows, different session_ids, deterministic ordering
```

Then:
```
/session meecap --label C2E01
/session recap range=recording --label C2E01 style=narrative
```

Both should use the *latest* session UUID (deterministic via `created_at_ms DESC`).  
✅ If both commands pick the same session, identity model is correct.
- ✅ Both live text and voice entries tagged with session_id
- ✅ Ingestion tool produces collision-free sessions (new UUID each run)
- ✅ Recording range query deterministic (ordered by created_at_ms)

---

### Sprint -1: Test Data Ingestion ✅ Complete

**Built:** `tools/ingest-media.ts` - Offline media ingestion pipeline

**Result:** Can now generate test ledger databases from campaign recordings for Phase 1 development. No more designing in a vacuum!

**Usage:** See "Ingest Test Data" in Common Workflows section above.

---

### Phase 1: Character Registry + Name Scanner ✅ Complete

**What was built:**

#### 1A: Character Registry System (YAML-based)
- `data/registry/` - Multi-file YAML structure:
  - `pcs.yml` - Playable characters (6 registered: Jamison, Minx, Louis, Snowflake, Evanora, Cyril)
  - `npcs.yml` - NPCs (3 registered: Sir Caldus, Uriah, Meepo)
  - `locations.yml` - Places (3 registered: Waterdeep, Immortal Bastion, Caeadim)
  - `factions.yml` - Template (empty, ready for expansion)
  - `ignore.yml` - Stopwords (79 common English words for filtering)
  - `decisions.pending.yml` - Review queue (1 candidate awaiting triage)
- `src/registry/loadRegistry.ts` - Multi-file loader with collision detection, type inference, normalization
- `src/registry/types.ts` - Type system (Registration, Entity, Character, Location, Faction)
- **Type inference:** `type` field auto-assigned from file location (pcs.yml → pc, npcs.yml → npc)
- **Validation:** Hard-fail on name collisions, soft-warn on redundant aliases

#### 1B: Name Discovery & Review Tools
- `src/tools/scan-names.ts` - Offline ledger scanner + YAML proposer
  - Extracts proper names from ledger entries via phrase extraction
  - Counts known hits (word-boundary matching against registry)
  - Ranks unknown candidates by frequency
  - Outputs `decisions.pending.yml` for human triage
- `src/tools/review-names.ts` - Interactive CLI for triaging candidates
  - Options: [n]pc, [l]ocation, [f]action, [i]gnore, [d]elete, [s]kip, [q]uit
  - Auto-generates unique IDs with collision checking
  - Incremental pending queue updates + YAML formatting with blank lines
  - **Exit condition achieved:** Registry stabilized with 6 PCs, 3 NPCs, 3 locations, 79 stopwords

#### 1C: Name Normalization + Ledger Integration
- `src/registry/normalizeText.ts` - Text normalization engine (146 lines, production-ready)
  - Longest-match-first word-boundary matching, case-insensitive
  - Handles aliases correctly (e.g., "Ira" → "Uriah", "James" → "Jamison")
  - Tests: 7/7 passing (wakeword protection verified ✅)
- **Ledger integration:** Added `content_norm TEXT` column to schema
- `src/db.ts` - Auto-migration on startup, backward compatible
- `src/voice/receiver.ts` - Live voice integration: normalizes after STT, stores both raw + normalized
- `tools/ingest-media.ts` - Offline ingestion: normalizes after STT, writes both fields
- **Dual-column approach:** Preserves fidelity (raw STT) while enabling consistency (normalized)

#### Meecap V1 Full Implementation (Phase 2 Complete) ✅
- `src/sessions/meecap.ts` - Complete V1 generator (~530 lines)
  - **Types:** LineSpan, LedgerIdRange, MeecapBeat, MeecapScene, Meecap
  - **Generator:** `generateMeecapStub()` - Calls LLM, parses JSON, validates, returns structured output
  - **Transcript builder:** `buildMeecapTranscript()` - Formats entries as `[L# id=uuid]` with normalized content
  - **Validator:** `validateMeecapV1()` - Comprehensive schema + ledger consistency checks
  - **Prompt builder:** `buildMeecapPrompts()` - System + user prompts with V1 schema template
- **Meecap V1 Contract:**
  - Line indices [L0, L1, ...] for editing convenience
  - Ledger IDs for stable references across transcript re-filtering
  - Ranges (not arrays) for scenes; small evidence lists for beats
  - Every scene/beat has ledger_id_range or evidence_ledger_ids
  - Validators run pre-persistence (no bad data in DB)
- **Database:** `meecaps` table with UPSERT pattern
  - Primary key: `session_id`
  - Columns: `meecap_json (TEXT)`, `created_at_ms (INTEGER)`, `updated_at_ms (INTEGER)`
  - On regeneration: `meecap_json` overwrites, `updated_at_ms` updates, `created_at_ms` preserved
- **Tested:** Generates 3-8 scenes, 8+ beats; JSON exports to Discord; validation catches invalid IDs

**Validation Errors Caught:**
- Missing/invalid version, session_id, session_span
- Ledger IDs not found in entries
- Range ordering violations (start > end)
- Empty evidence_ledger_ids
- Non-matching scene/beat line ranges

#### Meecap Stub Plumbing (OLD - ARCHIVED)
- ~~`src/sessions/meecap.ts` - Placeholder generator~~ → **Now full V1 implementation**
- ~~Handler: `/session recap mode=meecap` branches to stub~~ → **Now separate `/session meecap` command**
- ~~Status: Wired and ready for Phase 2 LLM prompt~~ → **Phase 2 complete, ready for Phase 3 gravity scoring**

#### Mode Option Refactor (UX Polish)
- Renamed `/session recap` mode choices for cleaner Discord UI:
  - ~~"Primary narrative only (voice + elevated)"~~ → `primary`
  - ~~"Full including secondary narrative"~~ → `full`
  - ~~"Structured scenes + beats (memory format)"~~ → `meecap`
- **Result:** Shorter, more discoverable in Discord command picker

**Validation:**
- ✅ Registry loads without errors, validation passes
- ✅ Scanner produces ranked candidates
- ✅ Review tool handles all edge cases (collision checking, YAML formatting)
- ✅ Normalizer: 7/7 test cases passing (includes wakeword robustness)
- ✅ DB migration auto-runs, dual fields stored correctly
- ✅ Meecap stub wired to recap handler
- ✅ TypeScript: `npx tsc --noEmit` clean
- ✅ End-to-end: Offline ingestion → normalization → recap all working

### Phase 2: Meecap V1 Generator ✅ Complete
- ✅ Meecap V1 schema fully defined and validated
- ✅ Ledger-ID anchoring (stable range references)
- ✅ LLM-driven generation with conservative constraints (4-8 scenes, 1-4 beats)
- ✅ Comprehensive validator (ID existence, range ordering, evidence non-empty)
- ✅ Database persistence + disk export for git diffing
- ✅ First-class command `/session meecap` with regeneration support
- ✅ Recap consumes Meecap (no longer generates)
- ✅ Narrative style recap with meecap structure + transcript detail
- ✅ Token/length guardrails (800-1500 words per recap)

**What's next (Phase 3 - Character-Scoped Retrieval):**
- Gravity scoring (Tier 1: Costly Love, Tier 2: Tenderness, Tier 3: Moral Fracture)
- Character impression tracking (beats involving PC)
- LLM-driven beat analysis for gravity assignment
- Memory retrieval + injection into response prompts

### Phase 3: Character-Scoped Retrieval (Future)
- `src/meepo/memory.ts` (new) - Scoped beat retrieval by character
- Update `src/sessions/meecap.ts` - Add gravity scoring post-generation
- Update `src/llm/prompts.ts` - Inject retrieved beats with gravity weighting

### Database Evolution
Current schema has what you need. As Meecap matures, add tables:
```sql
-- Future: post-session artifacts
meecap_sessions         -- session_id, meecap_json, created_at
beats                   -- beat_id, session_id, ..., gravity_tier
character_impressions   -- char_id, beats_count, summary
```

---

## Design Principles (Sacred)

1. **Diegetic Primacy**: Meepo thinks and acts *in the world*, not above it
2. **Strict Guardrails**: No hallucinated lore, ever—admit uncertainty
3. **Voice-First Narration**: Speech at the table is primary source
4. **Emotional Memory, Not Omniscience**: Meepo remembers *because* something mattered, not because it happened
5. **Graceful Degradation**: Log errors, don't crash; fallback mechanisms everywhere
6. **Scoped Authority**: NPC Mind only "sees" what's in perception scope

---

## Common Pitfalls

1. **Don't exclude Meepo's replies from context** — Conversational coherence requires them. NPC Mind will filter them from belief formation later.

2. **Keep narrative_weight and gravity separate** — They solve different problems. Weight filters crud; gravity orders emotional relevance.

3. **Ledger is omniscient; NPC Mind is scoped** — Ledger captures everything (including Meepo's own thoughts), but NPC Mind only uses what Meepo could know.

4. **STT normalization is regex, not LLM** — Avoids prompt contamination. Keep it simple (domain entities only).

5. **Cooldowns are per-guild** — Don't share state across guilds accidentally.

6. **End silence is 700ms, not event-based** — Discord `speaking.end` fires too early. Use stream lifecycle instead.

---

## Next Developer Checklist

- [ ] Read Project_Meepo.md (strategic vision)
- [ ] Read HANDOFF_V0.md (V0 implementation details, archived for reference)
- [ ] Read this file (current state)
- [ ] `npm run dev:bot` and test basic commands
- [ ] Set `LOG_LEVEL=debug LOG_SCOPES=voice` and test voice flow
- [ ] Ingest test data: Run `tools/ingest-media.ts` on campaign recording
- [ ] Pick Phase 1 task and start building

---

## File Locations Quick Reference

```
Docs:           docs/{HANDOFF.md, Project_Meepo.md, HANDOFF_V0.md}
Core:           src/{bot.ts, db.ts, pidlock.ts}
Personas:       src/personas/{*.ts}
Voice:          src/voice/{receiver, speaker, wakeword, voiceReply}.ts
STT/TTS:        src/voice/{stt,tts}/{provider,openai}.ts
Ledger:         src/ledger/{ledger, system}.ts
Commands:       src/commands/{meepo, session, index}.ts
LLM:            src/llm/{client, prompts}.ts
Logging:        src/utils/logger.ts
Tools:          tools/ingest-media.ts (offline test data generation)
Schema:         src/db/schema.sql
Scripts:        package.json (dev:bot, dev:deploy)
```

---

## Backlog & Future Improvements

### Schema Extraction Refactor (Lean, Not Urgent)
**Goal:** Reduce drift between bot schema and ingestion tool schema

**Current State:** Both `src/db.ts` and `tools/ingest-media.ts` maintain separate schema copies
- Acceptable for now (ingestion tool overwrites test DB frequently)
- No active drift yet

**Future Improvement (when you revisit schema management):**
Extract shared `ensureSchema(db)` function used by both:
```typescript
// src/db/initSchema.ts (new shared module)
export function ensureSchema(db: Database.Database): void {
  const schemaPath = path.join(process.cwd(), "src", "db", "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");
  db.exec(schema);
}

// src/db.ts (bot init)
import { ensureSchema } from "./db/initSchema.js";
export function getDb(): Database.Database {
  // ...
  ensureSchema(db);  // Replace inline schema loading
  applyMigrations(db);
  // ...
}

// tools/ingest-media.ts (ingestion init)
import { ensureSchema } from "../src/db/initSchema.js";
function initializeDb(dbPath: string): Database.Database {
  // ...
  ensureSchema(db);  // Same schema source
  const db = new Database(dbPath);
  // ...
}
```

**Benefit:** Single source of truth (no drift)  
**Cost:** Minimal refactoring  
**Timeline:** Nice-to-have when you next touch schema management

### Migration Safety Validation ✅ Verified
**Current state is production-safe for existing databases:**

**Migration pattern for `created_at_ms` (Feb 11):**
1. ✅ **Add as nullable:** `ALTER TABLE sessions ADD COLUMN created_at_ms INTEGER;`
2. ✅ **Backfill:** `UPDATE sessions SET created_at_ms = started_at_ms WHERE created_at_ms IS NULL` (idempotent guard)
3. ✅ **Leave nullable in SQLite:** SQLite can't enforce NOT NULL retroactively; handled at code level
4. ✅ **Always write in code:** `startSession()` always inserts `created_at_ms = now` (never null for new sessions)

**Result:**
- Old DBs: Existing sessions get `created_at_ms` from `started_at_ms` (best guess)
- New DBs: All sessions have `created_at_ms` populated via `startSession()`
- No corruption risk, safe to re-run (idempotent WHERE clause)

**For future NOT NULL columns, use this pattern:**
- Add nullable
- Backfill with guard (WHERE IS NULL)
- Leave nullable in schema
- Always populate in code

### Wakeword Detection Robustness
**Best practice (still lean):**

Treat wakeword detection as:
- Check **raw text** for wakewords (cheap substring/regex)
- Check **normalized text** for canonical wakeword too
- Trigger if **either** hits

That gives you the best of both worlds:
- Raw catches unexpected future variants
- Normalized catches alias variants you've curated

Even if you don't implement both right now, keep it in mind as the "if something gets flaky" fix.

**Current State:** Only checks normalized text (Phase 1C). Works fine but could be more resilient.

---

## Questions?

Refer to the detailed breakdowns in:
- **HANDOFF_V0.md** - V0 architecture deep-dive
- **Project_Meepo.md** - Strategic roadmap + design philosophy
- **src/utils/logger.ts** - Full logging docs in code comments
