# Meepo Bot

A D&D NPC Discord bot that functions as an in-world character with persistent memory, locality-gated knowledge, and conversation management.

## Overview

Meepo is a newborn celestial servant that participates in D&D sessions via Discord. The bot:
- Only speaks when directly addressed (or during active conversation windows)
- Forms persistent understanding of events through an append-only ledger
- Maintains diegetic boundaries (no omniscience, no meta-knowledge)
- Speaks in simple, gentle language with signature "meep" endings
- Provides DM tools for session recaps and event tracking

## Architecture

**Dual Knowledge System:**
- **Omniscient Ledger**: Append-only log of all messages (for DM tooling and recaps)
- **NPC Mind** (future): Locality-gated knowledge based on what Meepo perceives

**Key Components:**
- `src/bot.ts` - Main Discord event loop
- `src/meepo/state.ts` - NPC instance management (wake/sleep)
- `src/ledger/ledger.ts` - Append-only session logging
- `src/latch/latch.ts` - Conversation window state
- `src/llm/` - OpenAI integration with strict guardrails
- `src/sessions/` - D&D session tracking

## Setup

### Prerequisites
- Node.js 18+
- Discord bot token with Message Content intent enabled
- OpenAI API key

### Installation

1. **Clone and install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

3. **Required Discord bot setup:**
   - Enable "Message Content Intent" in Discord Developer Portal
   - Invite bot to your server with permissions: Read Messages, Send Messages, Use Slash Commands
   - Grant bot "View Channel" permission for channels it should monitor

4. **Register commands:**
   ```bash
   npm run dev:deploy
   ```

5. **Start the bot:**
   ```bash
   npm run dev:bot
   ```

## Commands

### `/meepo wake [persona]`
Awakens Meepo and binds it to the current channel. Auto-starts a session.
- `persona` (optional): Custom character traits to shape responses

### `/meepo sleep`
Puts Meepo to sleep and ends the active session.

### `/meepo status`
Shows Meepo's current state (active/sleeping, bound channel, persona).

### `/meepo hush`
Clears the conversation latch, forcing Meepo to be silent until addressed again.

### `/session recap <range>` (DM-only)
Generates a session recap from the ledger.
- `since_start`: Everything since session began
- `last_2h`: Last 2 hours
- `today`: Since midnight UTC

## Behavior

### Address Triggers
Meepo responds when:
- Mentioned via `@Meepo`
- Message starts with `meepo:` prefix
- Conversation latch is active (90s window after each response)

### Latch System
Once addressed, Meepo maintains a conversation window for 90 seconds. During this time, it responds to all messages without requiring re-addressing. Use `/meepo hush` to clear the latch manually.

### Speech Style
Meepo speaks as a newborn celestial:
- Short, simple sentences (1-3 typically)
- Gentle, curious, slightly unsure tone
- Every sentence ends with "meep"
- No emojis, no meta-references
- Admits ignorance when information is missing

### Anti-Hallucination Guardrails
- Only references events explicitly present in conversation context
- Never invents plot details, lore, or character actions
- Responds with uncertainty when information is outside perception
- Prefers silence over speculation

## Configuration

Edit `.env` to customize behavior:

```env
# Bot behavior
BOT_PREFIX=meepo:           # Address prefix
LATCH_SECONDS=90            # Conversation window duration

# LLM controls
LLM_ENABLED=true            # Set to false to test without API calls
LLM_MODEL=gpt-4o-mini       # OpenAI model to use
LLM_TEMPERATURE=0.3         # Lower = more consistent
LLM_MAX_TOKENS=200          # Response length limit
```

## Database

SQLite database at `./data/bot.sqlite` with:
- `npc_instances`: Active Meepo instances per guild
- `ledger_entries`: Append-only message log
- `sessions`: D&D session records
- `latches`: Conversation state tracking

**Schema migrations** run automatically on startup via `src/db.ts`.

## Development Workflow

### Day-to-day iteration:
```bash
# 1. Make code changes
# 2. Restart bot
npm run dev:bot

# 3. If commands changed, re-deploy
npm run dev:deploy
```

### Common patterns:
- Ledger logs ALL messages Meepo can see (broad scope for future STT)
- Bot's own replies tagged `bot_reply` (excluded from context, included in recaps)
- Message deduplication via unique `message_id` constraint
- Guild-only command registration during dev (faster deployment)

## Week 1 Status

**Completed:**
- ✅ Discord bot + slash commands
- ✅ NPC lifecycle (wake/sleep) with persistence
- ✅ Addressed-only replies + latch system
- ✅ Omniscient ledger logging
- ✅ Session auto-tracking (wake→start, sleep→end)
- ✅ LLM integration with strict guardrails
- ✅ DM-only session recap command
- ✅ Cost controls + kill switch

**Coming Next (Week 2+):**
- Voice channel integration
- STT (Speech-to-Text) transcription
- TTS (Text-to-Speech) output
- NPC Mind (locality-gated knowledge)
- LLM-powered recap summarization
- Multi-session support

## Project Vision

**Endgame:** A "Neuro-lite" in-world NPC that passively listens to voice sessions, forms persistent understanding over multiple campaigns, and is naturally conversable in-character with strict diegetic boundaries.

**Dual Interface:**
- **Ledger** (omniscient): DM tooling, session recaps, complete event log
- **NPC Mind** (locality-gated): Only knows what it perceives or is told

This Week 1 milestone establishes the text-only baseline with solid foundations for voice integration.

## License

ISC

## Troubleshooting

### Bot doesn't see messages
- Check "Message Content Intent" is enabled
- Verify bot has "View Channel" permission in the channel

### Duplicate message errors
- Expected and handled gracefully via unique constraint

### LLM costs concern
- Set `LLM_ENABLED=false` in .env for testing
- Adjust `LLM_MAX_TOKENS` to control response length
- Use `gpt-4o-mini` for cost-effective operation

### Commands not showing
- Run `npm run dev:deploy` after code changes
- Check bot has "Use Application Commands" permission
