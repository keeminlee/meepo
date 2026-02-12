# Meepo Bot

A narrative-aware Discord companion for D&D campaigns.

Meepo is an in-world character backed by a structured memory and knowledge system. It preserves session continuity, models epistemic boundaries (who knows what), and reflects character growth over time — without breaking immersion.

This repository contains the text-first foundation of that system.

---

# What Meepo Is (and Is Not)

Meepo is:

- An append-only session recorder
- A diegetic in-world persona
- A structured event extraction pipeline (Meecap)
- A foundation for deterministic NPC knowledge views
- An emotional “mirror” for party growth

Meepo is not:

- A lore-dumping encyclopedia
- A rules lawyer
- An omniscient meta-assistant
- A replacement for the DM

Transcript is canon.  
Knowledge is scoped.  
Meaning is reflected.

---

# High-Level Architecture

Meepo operates as layered systems:

## 1. Omniscient Ledger (Event Substrate)

An append-only SQLite log of all messages Meepo can see.

Used for:
- Canon reconstruction
- Session recaps
- Knowledge compilation
- Future voice ingestion
- Retcon-safe regeneration

The ledger is never edited — only derived from.

---

## 2. Structured Extraction (Meecap)

Session transcripts are transformed into structured events:

- Participants
- Witnesses
- Statements
- Belief-bearing moments
- Authority tiers

This enables future deterministic knowledge projections for:
- NPC personas
- Party knowledge state
- Topic-based knowledge packs
- DM-only planning views

---

## 3. Meepo (Mirror Persona)

Meepo is intentionally limited.

He:
- Reflects emotional shifts
- Surfaces patterns in behavior
- Anchors character continuity
- Reacts gently to growth and fracture

He does not:
- Reveal hidden knowledge
- Access planning documents
- Break diegetic boundaries

Meepo uses:
- Recent transcript context
- Emotionally weighted long-term memory (MeepoMind)

He reflects what is already there.

---

# Current Features (Week 1 Foundation)

- ✅ Discord bot with slash commands
- ✅ NPC lifecycle (wake/sleep) with persistence
- ✅ Addressed-only replies + 90s latch window
- ✅ Append-only ledger logging
- ✅ Automatic session tracking
- ✅ LLM integration with strict anti-hallucination guardrails
- ✅ DM-only session recap tooling
- ✅ Cost controls + kill switch

Structured knowledge compilation, and advanced persona routing are upcoming.

---

# Commands

## `/meepo wake [persona]`
Awakens Meepo and binds it to the current channel.
- Automatically starts a D&D session.
- Optional `persona` string modifies tone/traits.

## `/meepo sleep`
Puts Meepo to sleep and ends the active session.

## `/meepo status`
Shows current state (active/sleeping, bound channel, persona).

## `/meepo hush`
Clears the conversation latch immediately.

## `/session recap <range>` (DM-only)
Generates a structured recap from the ledger.
- `since_start`
- `last_5h`
- `today`
- `last recording` (for offline ingestion pipeline)

---

# Behavior

## Address Triggers

Meepo responds when:
- Mentioned via `@Meepo`
- Message starts with configured prefix (default `meepo:`)
- Conversation latch is active (default 90 seconds after response)

## Latch System

Once addressed, Meepo maintains a conversation window for a configurable duration. During this time, it responds without requiring re-addressing.

Use `/meepo hush` to close the latch manually.

---

# Speech Style

Meepo speaks as a newborn celestial:

- Short, simple sentences
- Gentle, curious tone
- Each sentence ends with “meep”
- No emojis
- No meta-references
- Admits uncertainty when outside perception

---

# Anti-Hallucination Guardrails

Meepo:

- Only references events explicitly present in context
- Does not invent lore, plot details, or character actions
- Responds with uncertainty when information is missing
- Prefers silence over speculation

Guardrails are enforced at the prompt and system level.

---

# Setup

## Prerequisites

- Node.js 18+
- Discord bot token (Message Content intent enabled)
- OpenAI API key

---

## Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment:
   ```bash
   cp .env.example .env
   ```

3. Edit `.env` with:
   - Discord bot token
   - OpenAI API key

---

## Discord Bot Configuration

In the Discord Developer Portal:

- Enable **Message Content Intent**
- Invite bot with:
  - Read Messages
  - Send Messages
  - Use Slash Commands
  - View Channel permissions

---

## Register Commands

```bash
npm run dev:deploy
```

---

## Start the Bot

```bash
npm run dev:bot
```

---

# Configuration

`.env` options:

```env
# Bot behavior
BOT_PREFIX=meepo:
LATCH_SECONDS=90

# LLM controls
LLM_ENABLED=true
LLM_MODEL=gpt-4o-mini
LLM_TEMPERATURE=0.3
LLM_MAX_TOKENS=200
```

---

# Database

SQLite database at `./data/bot.sqlite`.

Tables:

- `npc_instances` — Active Meepo instances per guild
- `ledger_entries` — Append-only message log
- `sessions` — D&D session records
- `latches` — Conversation state tracking

Schema migrations run automatically via `src/db.ts`.

---

# Development Workflow

## Typical Iteration

```bash
# Restart bot
npm run dev:bot

# If slash commands changed
npm run dev:deploy
```

---

## Design Patterns

- Ledger logs all visible messages.
- Bot replies tagged and excluded from future context.
- Message deduplication via unique `message_id`.
- Guild-only command registration for fast dev deployment.
- Derived artifacts are regenerable from the ledger.

---

# Roadmap

Planned evolution:

- Voice channel integration (STT/TTS)
- Structured event extraction (Meecap v2)
- Compiled NPC knowledge views
- Party knowledge projection
- Topic-based knowledge packs
- DM “Wanderer” orchestration console
- Belief-state modeling (belief ≠ truth)

Long-term direction:

A persistent narrative intelligence layer that scales with the campaign while preserving diegetic boundaries.

---

# License

ISC

---

# Troubleshooting

## Bot does not see messages
- Confirm Message Content Intent is enabled.
- Ensure bot has View Channel permission.

## Commands not appearing
- Run `npm run dev:deploy`.
- Verify Use Application Commands permission.

## Duplicate message errors
- Expected; safely handled via unique constraints.

## LLM cost concerns
- Set `LLM_ENABLED=false` for testing.
- Adjust `LLM_MAX_TOKENS`.
- Use `gpt-4o-mini` for cost efficiency.
