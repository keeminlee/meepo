# Meepo Bot - Context Handoff Document
**Date:** February 10, 2026  
**Status:** MVP Complete - Text-Only Baseline with LLM Recap

## Project Overview

Discord bot for D&D sessions: in-world NPC (Meepo) that listens, remembers, and converses with strict diegetic boundaries. No omniscience, no hallucination, locality-gated knowledge.

**Current Milestone:** Text-only baseline with LLM integration, session tracking, and persona transformation system.

---

## Core Architecture

### Dual Knowledge System (Foundational Design)
1. **Omniscient Ledger** - Append-only log of ALL messages for DM tooling and recaps
2. **NPC Mind** (future) - Locality-gated knowledge based on what Meepo perceives

**Current State:** Ledger fully implemented. NPC Mind deferred to Week 2+.

### Key Modules

```
src/
├── bot.ts                    # Main Discord event loop (with GuildVoiceStates intent)
├── db.ts                     # SQLite singleton + migrations
├── commands/
│   ├── meepo.ts             # /meepo wake|sleep|status|hush|transform|join|leave|stt
│   ├── session.ts           # /session recap|transcript (DM-only)
│   └── index.ts             # Command registry
├── meepo/
│   ├── state.ts             # NPC instance CRUD (wake/sleep/transform)
│   ├── triggers.ts          # Address detection (prefix/mention)
│   └── nickname.ts          # Bot nickname management per persona
├── latch/
│   └── latch.ts             # Conversation window state (90s default)
├── ledger/
│   ├── ledger.ts            # Append-only event log + queries
│   └── system.ts            # System event logging helper
├── sessions/
│   └── sessions.ts          # D&D session tracking (auto-start on wake)
├── llm/
│   ├── client.ts            # OpenAI API wrapper with kill switch
│   └── prompts.ts           # System prompt builder (persona-driven)
├── personas/
│   ├── meepo.ts             # Default form: baby celestial, ends with "meep"
│   ├── xoblob.ts            # Mimic form: riddles, Entity-13V flavor
│   └── index.ts             # Persona registry + StyleSpec system
├── voice/
    ├── state.ts             # In-memory voice state tracking
    ├── connection.ts        # Voice connection lifecycle
    └── receiver.ts          # Audio capture, PCM decode, anti-noise gating
```

---

## Database Schema (SQLite)

### Tables
```sql
npc_instances
  - id, name, guild_id, channel_id
  - persona_seed (optional custom traits)
  - form_id (default 'meepo', can be 'xoblob')
  - created_at_ms, is_active

ledger_entries
  - id, guild_id, channel_id, message_id
  - author_id, author_name, timestamp_ms, content
  - tags (human | npc,meepo,spoken | system,<event_type>)
  
  -- Voice & Narrative Authority (Phase 0)
  - source (text | voice | system)
  - narrative_weight (primary | secondary | elevated)
  - speaker_id (Discord user_id for voice attribution)
  - audio_chunk_path (nullable, only if STT_SAVE_AUDIO=true)
  - t_start_ms, t_end_ms (voice segment timestamps)
  - confidence (STT confidence 0.0-1.0)

sessions
  - session_id, guild_id
  - started_at_ms, ended_at_ms
  - started_by_id, started_by_name

latches
  - key, guild_id, channel_id, expires_at_ms
```

### Important Constraints
- `message_id` has unique index → deduplication (silent ignore on conflict)
- One active NPC per guild
- Sessions auto-start on wake, auto-end on sleep

---

## Narrative Authority System (Day 8 - Phase 0)

### Philosophy: One Ledger, Narrative Primacy

**Core Principle:** The Omniscient Ledger captures EVERYTHING (voice + text + system events), but voice is the **primary narrative source** reflecting D&D as played at the table. Text is secondary unless explicitly elevated.

This is **not** about data capture (everything is stored), but about **narrative authority** (what counts as "the session").

### Source Types
- **`text`** - Discord text messages (default for existing messages)
- **`voice`** - STT transcriptions from voice chat (primary narrative)
- **`system`** - Bot-generated events (session markers, wake/sleep/transform)

### Narrative Weight
- **`primary`** - Default for voice/system (used in recaps, NPC Mind)
- **`secondary`** - Default for text (stored but not primary narrative)
- **`elevated`** - Text explicitly marked important by DM (future: `/mark-important`)

### Default Behavior
- Recaps consume `narrative_weight IN ('primary', 'elevated')` by default
- DM can use `--full` flag to see all sources including secondary text
- NPC Mind (future) will filter to primary narrative + locality gating

### Privacy & Storage
- **No audio persistence by default** - Stream → transcribe → discard
- `audio_chunk_path` only populated if `STT_SAVE_AUDIO=true` (debugging)
- User already records sessions externally; redundant storage avoided

### System Events
Wake/sleep/transform commands now log system events with:
- `source='system'`
- `narrative_weight='primary'`
- `tags='system,npc_wake|npc_sleep|npc_transform'`

These appear in recaps as session markers, providing chronological anchors.

---

## Key Behavioral Rules

### 1. Speaking Scope
- Meepo ONLY replies in bound channel (`active.channel_id`)
- Never speaks outside bound channel (even if addressed)
- Ledger logs ALL messages bot can see (guild-wide for future voice/STT)

### 2. Address Triggers
Meepo responds when:
- Mentioned via `@Meepo`
- Message starts with `meepo:` prefix (configurable via `BOT_PREFIX`)
- Latch is active (90s window after last response)
- **NEW:** Auto-latch after `/meepo wake` or `/meepo transform` for immediate UX

### 3. Latch System
- Set on every response (extends 90s window)
- Cleared via `/meepo hush` or timeout
- Scoped to guild+channel
- **Auto-activated** on wake/transform for better UX

### 4. Ledger Tagging (CRITICAL)
- Human messages: `tags: "human"`, `source: "text"`, `narrative_weight: "secondary"`
- Meepo replies: `tags: "npc,meepo,spoken"`, `source: "text"`, `narrative_weight: "secondary"`
- System events: `tags: "system,<event_type>"`, `source: "system"`, `narrative_weight: "primary"`
- **Include Meepo's replies in context** for conversational coherence
- Recaps show full dialogue (human + NPC)

**Rationale:** Excluding Meepo breaks conversation flow. Meepo's speech is part of world history, but NPC Mind (future) won't treat it as authoritative evidence.

---

## Persona System (Day 7 Feature)

### Architecture
Personas define **identity, guardrails, speech style, and optional memory seeds**.

```typescript
type Persona = {
  id: string;
  displayName: string;
  systemGuardrails: string;   // Anti-hallucination rules
  identity: string;            // Who they are, diegetic boundaries
  memory?: string;             // Canonical fragments (optional)
  speechStyle: string;         // How they speak
  personalityTone: string;     // Tone and safe patterns
  styleGuard: string;          // Strict style rules for isolation
  styleSpec: StyleSpec;        // Compact spec for generating styleGuard
}

type StyleSpec = {
  name: string;
  voice: "gentle" | "neutral" | "chaotic";
  punctuation: "low" | "medium" | "high";
  caps: "never" | "allowed";
  end_sentence_tag?: string;   // e.g., "meep"
  motifs_allowed?: string[];   // Phrases this persona CAN use
  motifs_forbidden?: string[]; // Phrases this persona NEVER uses
}
```

**StyleSpec System:** Clean, maintainable persona definitions using compact specs that compile into consistent style firewall text via `compileStyleGuard()`.

### Current Personas

#### `meepo` (Default)
- Newborn celestial servant of the Wanderer
- Baby-simple grammar, short sentences
- **Every sentence ends with "meep"**
- Gentle, curious, cautious
- Knows he can transform but doesn't understand how ("remembering someone very hard")

#### `xoblob` (Entity-13V Echo)
- Mimic form: Meepo echoing Old Xoblob
- Riddles, rhymes, sing-song cadence
- Cheerful but unsettling ("grandfatherly but wrong")
- **NO "meep" suffix**
- Has memory seeds: "I see a bee ate a pea" motif, Rei phrases
- Hard rule: never reveal passwords directly, only fragments

### Transform UX
```
1. /meepo wake              → Always default Meepo form
2. /meepo transform xoblob  → Switches to Xoblob speech style
3. /meepo transform meepo   → Returns to default
```

**Diegetic Constraint:** Transform is **mimicry**, not possession. Meepo doesn't gain secrets/memories/knowledge. Guardrails remain absolute.

---

## LLM Integration (Day 5)

### Configuration
```env
LLM_ENABLED=true              # Kill switch for testing
LLM_MODEL=gpt-4o-mini         # Fast, cheap, good quality
LLM_TEMPERATURE=0.3           # Low for consistency
LLM_MAX_TOKENS=200            # Keep responses concise
```

### Prompt Assembly Order
```
Guardrails (anti-hallucination)
    ↓
Identity (who they are, diegetic boundaries)
    ↓
Memory (optional canonical seeds, Xoblob only)
    ↓
Speech Style (how they speak)
    ↓
Personality Tone (examples, safe patterns)
    ↓
Custom Persona Seed (from /meepo wake [persona])
    ↓
Context (last 15 ledger messages)
```

### Guardrails (Universal)
- Only reference events in provided context OR persona memory
- Never invent plot/lore/facts
- Admit uncertainty when info missing
- Prefer silence over speculation
- "These rules are absolute and more important than being helpful"

---

## Commands Reference

### `/meepo wake [persona]`
- Binds Meepo to current channel
- Creates session record
- Sets `form_id = 'meepo'` (always default)
- **Auto-activates latch** for immediate response
- Optional `persona`: custom traits to shape responses

### `/meepo sleep`
- Deactivates Meepo
- Ends active session
- Clears latch

### `/meepo status`
- Shows: awake/sleeping, bound channel, current form, persona, created timestamp

### `/meepo hush`
- Clears latch manually
- Meepo goes silent until addressed again

### `/meepo transform <character>`
- **NEW:** Switches persona (meepo | xoblob)
- Choices presented as dropdown
- **Auto-activates latch** for immediate response
- Flavor text: "Meepo curls up... and becomes an echo of Old Xoblob."

### `/session transcript <range>` (DM-only)
- **NEW:** Display raw session transcript from ledger
- Ranges: `since_start`, `last_5h`, `today`
- Outputs chronological dialogue with timestamps
- No summarization - verbatim ledger slice
- DM-only via `DM_ROLE_ID` env check

### `/session recap <range>` (DM-only)
- **NEW:** LLM-generated session summary
- Uses **same ledger slice logic** as transcript
- Ranges: `since_start`, `last_5h`, `today`
- Summarizes via GPT with structured format:
  - Overview (3-6 sentences)
  - Chronological Beats
  - NPCs & Factions
  - Player Decisions & Consequences
  - Conflicts & Resolutions
  - Clues, Loot, & Lore
  - Open Threads / To Follow Up
- **Auto-sends as .md file** if summary exceeds 1950 characters
- DM-only via `DM_ROLE_ID` env check

**Architecture:** `recap = summarize(transcript(slice))` - single source of truth for ledger slicing.

---

## Environment Variables

```env
# Discord
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
GUILD_ID=...                      # Guild-only commands during dev

# Permissions
DM_ROLE_ID=...                    # For DM-only commands

# Bot Behavior
BOT_PREFIX=meepo:
LATCH_SECONDS=90
MEEPO_HOME_TEXT_CHANNEL_ID=...    # (unused, legacy)

# Database
DB_PATH=./data/bot.sqlite

# LLM
OPENAI_API_KEY=...
LLM_ENABLED=true
LLM_MODEL=gpt-4o-mini
LLM_TEMPERATURE=0.3
LLM_MAX_TOKENS=200
```

---

## Recent Changes (Days 5-8)

### Day 5: LLM Integration
- OpenAI SDK installed
- `chat()` wrapper with error handling
- Prompt builder using personas
- Replaced "meep" stub with GPT-4 responses
- Fallback to "meep (LLM unavailable)" on API errors

### Day 6: Hardening
- LLM kill switch (`LLM_ENABLED=false`)
- Env-configurable model/temp/tokens
- Ledger deduplication (silent ignore on unique constraint)
- Bot reply logging with `npc,meepo,spoken` tags
- **REVERTED exclusion** of bot replies from context (needed for coherence)
- Added .env.example and README.md

### Day 7: Transform System
- Added `form_id` to `npc_instances` schema
- Migration auto-applies on startup
- Persona registry: meepo.ts, xoblob.ts, index.ts
- `/meepo transform` command with choices
- Prompt builder uses `getPersona(form_id)`
- Auto-latch on wake/transform for better UX
- Meepo identity updated to understand transformation

### Day 7 (Phase 2): Xoblob Enrichment
- Entity-13V flavor (cage labels, containment level, speech filter)
- Memory seeds: "bee/pea/eight/sting" riddle motif, wet stone, glass teeth
- Hard rule: never reveal passwords cleanly
- Safe deflection patterns added

### Day 8: MVP Cleanup & Session Recap System
- **REMOVED:** Style bleed feature completely (experimental feature removed for clean MVP)
  - Deleted `src/meepo/bleed.ts`
  - Removed `pending_style_reset` database field and migration
  - Removed `/meepo bleed` command
  - Removed conditional bleed overlays from prompts
- **ADDED:** StyleSpec system for clean persona definitions
  - Compact specs with voice/punctuation/caps/motifs fields
  - `compileStyleGuard()` generates consistent style firewalls
  - Easier to maintain and extend
- **ADDED:** `/session transcript` command
  - Raw ledger output with timestamps
  - Three time ranges: `since_start`, `last_5h`, `today`
  - Verbatim dialogue display
- **UPGRADED:** `/session recap` command
  - LLM-powered summarization using GPT
  - Structured output format (Overview, Beats, NPCs, Decisions, etc.)
  - Auto-sends as `.md` file attachment if > 1950 characters
  - Shares ledger slicing logic with transcript command
- **CHANGED:** Session time range from 2 hours to 5 hours for better coverage

### Day 8 (Phase 0): Narrative Authority Foundation
- **ARCHITECTURE:** Separate data capture from narrative authority
  - Voice = primary narrative source (reflects D&D at table)
  - Text = secondary unless elevated (stored but not default for recaps)
  - System events = primary (session markers, state changes)
- **SCHEMA EXTENSION:** Added voice/narrative fields to `ledger_entries`
  - `source` (text | voice | system)
  - `narrative_weight` (primary | secondary | elevated)
  - `speaker_id` (Discord user_id for voice attribution)
  - `audio_chunk_path` (nullable, only if STT_SAVE_AUDIO=true)
  - `t_start_ms`, `t_end_ms` (voice segment timestamps)
  - `confidence` (STT confidence score)
- **SYSTEM EVENTS:** Wake/sleep/transform now log to ledger
  - `source='system'`, `narrative_weight='primary'`
  - Provides session chronological anchors
  - Created `src/ledger/system.ts` helper
- **PRIVACY:** No audio storage by default (stream → transcribe → discard)
- **MIGRATION:** Auto-applies on startup, backward compatible
- **PID LOCK:** Prevents multiple bot instances
  - Lock file: `./data/bot.pid`
  - Checks if existing process is running on startup
  - Overwrites stale locks from crashed processes
  - Auto-cleanup on graceful exit (SIGINT/SIGTERM)
- **BUG FIX:** Double-response on redundant transforms
  - Transform handler now acknowledges "already in form" requests
  - Prevents LLM from hallucinating creative transform descriptions
- **BUG FIX:** TypeScript compilation error in deploy-dev.ts
  - Added non-null assertions for env vars after guard check
  - Clean compilation with strict mode
- **PERSONA CLEANUP:** Removed character-specific references from Xoblob
  - Replaced Rei phrases with generic creepy imagery (wet stone, glass teeth)
  - Maintains Entity-13V flavor without external character dependencies

---

## Critical Design Decisions

### 1. Narrative Authority vs Data Capture (Day 8 - Phase 0)
**Decision:** One omniscient ledger with narrative weight tiers.

**Rationale:**
- Voice is primary because D&D is played at the table (diegetic primacy)
- Text is secondary chatter unless explicitly elevated
- Everything is captured (omniscient), but primacy defines "the session"
- Recaps/NPC Mind default to primary narrative (voice + system + elevated text)
- DM can query full ledger for diagnostics (omniscient view)
- No audio persistence by default (user already records sessions)

### 2. Ledger Includes Bot Replies (FINAL)
**Decision:** Log Meepo's replies with `npc,meepo,spoken` tags and include in context.

**Rationale:**
- Conversational coherence requires seeing full dialogue
- Without Meepo's replies, recaps are nonsensical
- Meepo's speech IS part of world history
- NPC Mind (future) will filter Meepo's words from belief formation
- 15-message limit prevents runaway feedback loops

### 3. Transform is Mimicry, Not Omniscience
**Decision:** Transformation changes speech style only; no new knowledge granted.

**Diegetic Rules:**
- Meepo is always Meepo (identity preserved)
- Echoes remembered speech patterns, not true mind
- Guardrails remain absolute across all forms
- Persona memory seeds are "fixed fragments," not omniscience

### 4. Auto-Latch on Wake/Transform
**Decision:** Automatically activate latch after wake/transform commands.

**Rationale:**
- Better UX - no need to explicitly address after intentional wake
- Wake/transform IS an addressing action
- Still bound to channel (no omnipresence)
- Can be cleared with `/meepo hush`

### 5. Session Auto-Tracking
**Decision:** Sessions start on `/meepo wake`, end on `/meepo sleep`.

**Rationale:**
- Simpler than manual `/session start/end`
- Natural mapping: Meepo's presence = session active
- Voice-first use case (sessions track when NPC is "listening")

---

## Tech Stack

- **Runtime:** Node.js 18+ with tsx (no build step)
- **Discord:** discord.js v14
- **Database:** better-sqlite3 (WAL mode)
- **LLM:** OpenAI SDK (gpt-4o-mini)
- **TypeScript:** Strict mode, no decorators

---

## Migration Path & Migrations

### Database Migrations (Auto-Apply)
Applied via `getDb()` in src/db.ts on startup:
```typescript
// Migration: Add form_id to npc_instances (Day 7)
ALTER TABLE npc_instances ADD COLUMN form_id TEXT NOT NULL DEFAULT 'meepo'

// Migration: Add voice/narrative fields to ledger_entries (Day 8 - Phase 0)
ALTER TABLE ledger_entries ADD COLUMN source TEXT NOT NULL DEFAULT 'text';
ALTER TABLE ledger_entries ADD COLUMN narrative_weight TEXT NOT NULL DEFAULT 'secondary';
ALTER TABLE ledger_entries ADD COLUMN speaker_id TEXT;
ALTER TABLE ledger_entries ADD COLUMN audio_chunk_path TEXT;
ALTER TABLE ledger_entries ADD COLUMN t_start_ms INTEGER;
ALTER TABLE ledger_entries ADD COLUMN t_end_ms INTEGER;
ALTER TABLE ledger_entries ADD COLUMN confidence REAL;
```

Future migrations follow same pattern - check column existence, apply if missing.

---

## Common Workflows

### Development Iteration
```bash
# Make code changes
npm run dev:bot        # Start bot

# If commands changed
npm run dev:deploy     # Re-register slash commands
```

### Testing Flow
```
1. /meepo wake persona:grumpy scout
2. Send "hi" (no prefix) → Meepo responds (auto-latch works)
3. Natural conversation for 90s
4. /session transcript last_1h
5. /session recap last_1h
```

### Voice Testing Flow (Phase 1-2 Complete)
```
1. /meepo wake
2. Join a voice channel
3. /meepo join → Bot joins voice
4. /meepo stt status → Shows connected, STT disabled
5. /meepo stt on → Enables audio capture
   - Console: [Receiver] Starting receiver...
6. Speak normally → Console: 🔇 Speaking ended: audioMs=..., activeMs=..., peak=...
7. Keyboard click → Silently gated (or debug log if DEBUG_VOICE=true)
8. /meepo stt off → Stops receiver
9. /meepo leave → Disconnects from voice
```

---

## Voice Integration Roadmap

### ✅ Phase 1: Voice Presence (COMPLETE)
- `/meepo join` / `/meepo leave` commands
- Voice connection via `@discordjs/voice`
- `/meepo stt on|off|status` commands (toggle transcription)
- GuildVoiceStates intent enabled
- Receiver-ready setup (selfDeaf: false, selfMute: true)
- Clean disconnect handling with state cleanup

**Files:**
- `src/voice/state.ts` - In-memory voice state tracking
- `src/voice/connection.ts` - Voice connection lifecycle
- `src/commands/meepo.ts` - Join/leave/stt commands

### ✅ Phase 2: Audio Capture & Gating (COMPLETE - Tasks 1-2)
- Per-user audio stream subscription with `EndBehaviorType.AfterSilence` (250ms)
- Opus decode → PCM via prism-media
- Conservative anti-noise gating:
  - Minimum audio: 250ms of actual PCM content (not wall-clock time)
  - Activity-based filtering: 20ms RMS frame analysis (MIN_ACTIVE_MS = 200ms)
  - Per-user cooldown: 300ms (prevents rapid retriggers)
  - Long audio (≥1.2s) bypasses activity gate and cooldown
- Duplicate subscription prevention
- Stream lifecycle finalization (not speaking state)
- Clean log levels (operational always-on, debug-gated noise)

**Files:**
- `src/voice/receiver.ts` - Audio capture, PCM decode, frame-level gating

**Dependencies:**
- `@discordjs/voice` - Voice connection and receiver
- `prism-media` (via @discordjs/voice) - Opus decoding

**Current Logs:**
- Always: `Starting receiver`, `Stopping receiver`, `Speaking ended: audioMs=..., activeMs=..., peak=...`
- Debug only: `Speaking started`, `Gated: reason=...`, stream errors

### 🚧 Phase 2: STT Provider Interface (NEXT - Task 3)
- Create `src/voice/stt/provider.ts` with pluggable interface:
  ```typescript
  interface SttProvider {
    transcribePcm(pcm: Buffer, sampleRate: number): Promise<string>;
  }
  ```
- Noop provider for testing
- Wire receiver to call provider on accepted utterances
- Emit ledger events: `{event:"stt_transcript", userId, text, confidence:null}`
- Cap buffer size to prevent runaway memory

### ⏳ Phase 3: Real STT (Whisper)
- OpenAI Whisper API integration (matches LLM pattern: kill switch, API key)
- Environment variables:
  ```
  STT_PROVIDER=openai          # or 'local' for whisper.cpp
  WHISPER_API_KEY=...
  STT_LANGUAGE=en
  STT_SAVE_AUDIO=false         # Debug mode only
  ```
- Append to ledger with `source='voice'`, `narrative_weight='primary'`
- Stream → transcribe → discard (no audio storage by default)

### ⏳ Phase 4: Narrative-Aware Recaps
- `/session recap` defaults to primary narrative only (voice-first)
- Add `--full` flag for omniscient view (all sources)
- DM recap includes diagnostics (coverage %, unknown speakers, low-confidence warnings)

### ⏳ Phase 5: Text Elevation
- `/mark-important <message_id>` (DM-only) → Sets `narrative_weight='elevated'`
- Auto-elevate: commands, transforms, NPC state changes
- Optional: Auto-elevate text addressed to Meepo when in voice

### ⏳ Phase 6: TTS Output
- Meepo speaks responses in voice when joined
- Persona-specific voices (OpenAI TTS or ElevenLabs)

**Voice/Narrative Migration:** Old databases get voice/narrative fields added with safe defaults (`source='text'`, `narrative_weight='secondary'`)

---

## Gotchas & Important Notes

1. **PID Lock:** Bot uses `./data/bot.pid` to prevent multiple instances. If you see "Bot already running" on startup, either kill the existing process or delete the stale lock file if the process crashed.

2. **Message Content Intent:** Must be enabled in Discord Developer Portal or bot can't read messages

3. **GuildVoiceStates Intent:** Required for voice channel detection. Must be enabled in code (`GatewayIntentBits.GuildVoiceStates`) - not a privileged intent.

4. **View Channel Permission:** Bot must have "View Channel" permission to receive events

5. **Unique Message ID:** Ledger deduplication handles this gracefully (silent ignore), but duplicates shouldn't happen

6. **Form ID Migration:** Old databases get `form_id='meepo'` auto-added on startup

---

## File Locations Reference

**Schema:** `src/db/schema.sql`  
**Migrations:** `src/db.ts` (inline)  
**Main Loop:** `src/bot.ts` messageCreate handler  
**Personas:** `src/personas/*.ts`  
**Commands:** `src/commands/*.ts`  
**Ledger:** `src/ledger/ledger.ts` (core), `src/ledger/system.ts` (system events)  
**Docs:** `README.md`, `.env.example`

---

## Next Chat Starting Point

**You are picking up a Discord bot project with voice capture implemented.**

**Current Status:** 
- **Text-only MVP complete** with LLM-powered persona system and session recap
- **Phase 0 (Narrative Authority) complete** - Schema extended for voice integration
- **Phase 1 (Voice Presence) complete** - Bot can join/leave voice, toggle STT
- **Phase 2 (Audio Capture) partially complete** - PCM capture working with anti-noise gating
  - ✅ Tasks 1-2: Speaking detection, Opus decode, frame-level activity gating
  - 🚧 Task 3: STT provider interface (next step)

**Architecture Highlights:**
- One omniscient ledger with narrative weight tiers (voice primary, text secondary)
- System events logged (wake/sleep/transform appear in recaps)
- Conservative anti-noise gating: PCM-based duration (not wall-clock), RMS frame analysis
- No audio persistence by default (privacy-first)
- Per-user voice attribution ready (schema supports Discord user IDs)

**Next Steps - Choose Direction:**
- **Phase 2 Task 3:** Implement STT provider interface (pluggable, noop for testing)
- **Phase 3:** Real STT with OpenAI Whisper API integration
- **Phase 4:** Narrative-aware recaps (voice-first, with --full flag)
- **Phase 5:** Text elevation tools (`/mark-important` for DMs)
- **Phase 6:** TTS output (Meepo speaks in voice)
- **More Personas:** Add new character forms with unique speech patterns
- **NPC Mind:** Locality-gated knowledge system (belief formation from perceived events)
- **Bug fixes or UX improvements**

**Test Voice Capture:**
```bash
npm run dev:bot
```

In Discord:
```
/meepo wake
Join voice channel
/meepo join
/meepo stt on
<speak normally> → Console shows: 🔇 Speaking ended: audioMs=..., activeMs=...
<keyboard click> → Silently gated (too short)
```

## Gotchas & Important Notes

1. **PID Lock:** Bot uses `./data/bot.pid` to prevent multiple instances. If you see "Bot already running" on startup, either kill the existing process or delete the stale lock file if the process crashed.

2. **Message Content Intent:** Must be enabled in Discord Developer Portal or bot can't read messages

2. **View Channel Permission:** Bot must have "View Channel" permission to receive events

3. **Unique Message ID:** Ledger deduplication handles this gracefully (silent ignore), but duplicates shouldn't happen

4. **Form ID Migration:** Old databases get `form_id='meepo'` auto-added on startup

5. **Latch Scope:** Currently guild+channel key. Could be refactored to channel-only if multi-guild support needed.

6. **Transform vs Persona Seed:**
   - `form_id`: Which persona definition to use (meepo, xoblob)
   - `persona_seed`: Optional custom traits from `/meepo wake [persona]`
   - Both can coexist: transform changes base persona, seed adds flavor

---

## File Locations Reference

**Schema:** `src/db/schema.sql`  
**Migrations:** `src/db.ts` (inline)  
**Main Loop:** `src/bot.ts` messageCreate handler  
**Personas:** `src/personas/*.ts`  
**Voice:** `src/voice/*.ts` (state, connection, receiver)  
**Commands:** `src/commands/*.ts`  
**Ledger:** `src/ledger/ledger.ts` (core), `src/ledger/system.ts` (system events)  
**Docs:** `README.md`, `.env.example`

---

## Key Commands to Know

```bash
npm run dev:bot        # Start bot
npm run dev:deploy     # Register commands (if commands changed)
npx tsc --noEmit      # Type check without building
```

**Test in Discord:**
```
# Text-only testing
/meepo wake
hi                     # Auto-latch works, Meepo responds
/meepo transform xoblob
what do you know?      # Xoblob riddles
/session transcript last_5h
/session recap last_5h # LLM summary (may be file attachment)

# Voice testing
/meepo wake
<join voice channel>
/meepo join
/meepo stt on         # Console: [Receiver] Starting receiver...
<speak normally>      # Console: 🔇 Speaking ended: audioMs=..., activeMs=..., peak=...
/meepo stt off
/meepo leave
```

**Recent Major Changes (Day 8-10):**
- Phase 1 voice integration complete (join/leave, STT toggle)
- Phase 2 audio capture complete (PCM decode, anti-noise gating)
- Conservative gating: PCM-based duration + RMS frame activity analysis
- GuildVoiceStates intent added to bot.ts
- Reflavored voice messages to be more Meepo-like ("Meep!")
- Clean log levels (operational vs debug)

**Read This First:**
- README.md (user-facing docs)
- This file (developer handoff)
- src/personas/*.ts (to understand identity system)
- src/voice/receiver.ts (audio capture pipeline)
- src/commands/meepo.ts (voice commands)

Good luck! 🎲

