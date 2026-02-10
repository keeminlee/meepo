# Meepo Bot - Context Handoff Document
**Date:** February 10, 2026  
**Status:** Week 1 Complete + Transform MVP

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
├── bot.ts                    # Main Discord event loop
├── db.ts                     # SQLite singleton + migrations
├── commands/
│   ├── meepo.ts             # /meepo wake|sleep|status|hush|transform
│   ├── session.ts           # /session recap (DM-only)
│   └── index.ts             # Command registry
├── meepo/
│   ├── state.ts             # NPC instance CRUD (wake/sleep/transform)
│   └── triggers.ts          # Address detection (prefix/mention)
├── latch/
│   └── latch.ts             # Conversation window state (90s default)
├── ledger/
│   └── ledger.ts            # Append-only event log + queries
├── sessions/
│   └── sessions.ts          # D&D session tracking (auto-start on wake)
├── llm/
│   ├── client.ts            # OpenAI API wrapper with kill switch
│   └── prompts.ts           # System prompt builder (persona-driven)
└── personas/
    ├── meepo.ts             # Default form: baby celestial, ends with "meep"
    ├── xoblob.ts            # Mimic form: riddles, Entity-13V flavor
    └── index.ts             # Persona registry + type definitions
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
  - tags (human | npc,meepo,spoken)

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
- Human messages: `tags: "human"`
- Meepo replies: `tags: "npc,meepo,spoken"`
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
}
```

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

### `/session recap <range>` (DM-only)
- Ranges: `since_start`, `last_2h`, `today`
- Queries ledger by timestamp
- Returns chronological list (currently text dump, LLM summarization future)
- DM-only via `DM_ROLE_ID` env check

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

## Recent Changes (Days 5-7)

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

### Day 7 (Latest): Xoblob Enrichment
- Entity-13V flavor (cage labels, containment level, speech filter)
- Memory seeds: "bee/pea/eight/sting" riddle motif
- Rei phrases: "Little dove... mushy bricks"
- Hard rule: never reveal passwords cleanly
- Safe deflection patterns added

---

## Critical Design Decisions

### 1. Ledger Includes Bot Replies (FINAL)
**Decision:** Log Meepo's replies with `npc,meepo,spoken` tags and include in context.

**Rationale:**
- Conversational coherence requires seeing full dialogue
- Without Meepo's replies, recaps are nonsensical
- Meepo's speech IS part of world history
- NPC Mind (future) will filter Meepo's words from belief formation
- 15-message limit prevents runaway feedback loops

### 2. Transform is Mimicry, Not Omniscience
**Decision:** Transformation changes speech style only; no new knowledge granted.

**Diegetic Rules:**
- Meepo is always Meepo (identity preserved)
- Echoes remembered speech patterns, not true mind
- Guardrails remain absolute across all forms
- Persona memory seeds are "fixed fragments," not omniscience

### 3. Auto-Latch on Wake/Transform
**Decision:** Automatically activate latch after wake/transform commands.

**Rationale:**
- Better UX - no need to explicitly address after intentional wake
- Wake/transform IS an addressing action
- Still bound to channel (no omnipresence)
- Can be cleared with `/meepo hush`

### 4. Session Auto-Tracking
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
4. /meepo transform xoblob
5. Send "what do you know?" → Xoblob riddly response
6. /session recap since_start
```

---

## Known Issues & Future Work

### Week 2+ Roadmap
- **Voice integration:** Join voice channel, audio stream capture
- **STT:** OpenAI Whisper for transcription with speaker attribution
- **TTS:** Voice output for Meepo replies
- **NPC Mind:** Locality-gated knowledge system (separate from Ledger)
- **LLM Recap:** Replace text dump with GPT-4 summarization (DM vs party modes)
- **Multi-session support:** Schema ready, needs UI commands

### Current Limitations
- Recap is chronological dump (no LLM summarization yet)
- No voice/STT (text-only)
- One NPC per guild (multi-NPC future)
- Guild-scoped latches (could be channel-scoped)
- No semantic search (uses recent N messages)

---

## Gotchas & Important Notes

1. **Message Content Intent:** Must be enabled in Discord Developer Portal or bot can't read messages

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
**Commands:** `src/commands/*.ts`  
**Docs:** `README.md`, `.env.example`

---

## Next Chat Starting Point

**You are picking up a Discord bot project in working state.**

**Current Focus:** Week 1 complete (text-only baseline). Ready for Week 2 (voice/STT) or Day 7+ polish (LLM recap, NPC Mind foundations).

**Ask the user:**
- Continue with voice integration?
- Polish recap system with LLM summarization?
- Add more personas/forms?
- Bug fixes or UX improvements?

**Key Commands to Know:**
```bash
npm run dev:bot        # Start bot
npm run dev:deploy     # Register commands
```

**Test in Discord:**
```
/meepo wake
/meepo transform xoblob
/session recap since_start
```

**Read This First:**
- README.md (user-facing docs)
- This file (developer handoff)
- src/personas/*.ts (to understand identity system)

Good luck! 🎲
