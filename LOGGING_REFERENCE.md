# Logging Reference for Meepo Bot

**Updated:** February 16, 2026

This document describes all logging scopes, output levels, and how to configure logging for debugging and operations monitoring.

---

## Quick Start

```bash
# Run with default logging (INFO level, all scopes)
npm run dev:bot

# Run with verbose voice debugging
LOG_LEVEL=debug LOG_SCOPES=voice,voice-reply npm run dev:bot

# Run with minimal logging (warnings/errors only)
LOG_LEVEL=warn npm run dev:bot

# Run with structured JSON output (for log aggregation)
LOG_FORMAT=json npm run dev:bot
```

---

## Environment Variables

### `LOG_LEVEL`
Controls the minimum severity of logs that are displayed.

**Values:** `trace`, `debug`, `info`, `warn`, `error`  
**Default:** `info`

| Level | Use For |
|-------|---------|
| `trace` | Deep debugging (rarely needed) |
| `debug` | Detailed subsystem info, preconditions, state transitions |
| `info` | Important operational events, state changes, boot messages |
| `warn` | Recoverable issues, fallbacks, unusual conditions |
| `error` | Failures, exceptions, unrecoverable errors |

### `LOG_SCOPES`
Filter which subsystems produce logs (comma-separated list). If empty, all scopes are allowed.

**Available Scopes:**
- `boot` — Bot startup, PID lock, discord client readiness
- `overlay` — Overlay HTTP server, WebSocket, token building
- `voice` — Voice channel connections, player state, audio setup
- `voice-reply` — Voice reply pipeline, precondition checks, LLM calls
- `stt` — Speech-to-text transcription, Whisper API
- `tts` — Text-to-speech synthesis, OpenAI TTS API
- `audio-fx` — Post-TTS audio effects (pitch, reverb)
- `meepo` — Meepo state (wake, form changes, auto-sleep)
- `meepo-mind` — Knowledge base seeding and retrieval
- `ledger` — GPTcap loading, narrative ledger operations
- `db` — Database migrations (if needed)
- `session` — Session management
- `llm` — LLM client calls and responses

**Default:** All scopes allowed (empty string)

**Examples:**
```bash
# Only voice debugging
LOG_LEVEL=debug LOG_SCOPES=voice npm run dev:bot

# Voice reply + speech-to-text
LOG_LEVEL=debug LOG_SCOPES=voice-reply,stt npm run dev:bot

# Meepo operations only
LOG_LEVEL=debug LOG_SCOPES=meepo npm run dev:bot

# Everything except TTS/STT
LOG_LEVEL=debug LOG_SCOPES=boot,overlay,voice,voice-reply,meepo npm run dev:bot
```

### `LOG_FORMAT`
Output format for logs.

**Values:** `pretty`, `json`  
**Default:** `pretty`

- `pretty` — Human-readable with timestamps and scopes
- `json` — Machine-readable (for log aggregation, ELK, etc.)

### `DEBUG_VOICE` (Deprecated)
Legacy environment variable for voice debugging. Use `LOG_LEVEL=debug LOG_SCOPES=voice` instead.

---

## Log Scope Details

### `boot` (INFO default)
**Files:** `src/bot.ts`, `src/pidlock.ts`

**Logs:**
- `Meepo online as @bot_tag` — Discord client ready
- `PID lock acquired (12345)` — Lock file written
- `AUTO-WAKE triggered by user_name` — Message-triggered wake
- `Chat transform detected: meepo → xoblob` — Form transformation
- `Already in form xoblob - acknowledging` — Transform no-op
- Startup errors, lock conflicts

**Why:** Tracks bot lifecycle and major state changes visible to operators.

---

### `overlay` (INFO default)
**Files:** `src/overlay/server.ts`, `src/bot.ts`

**Logs:**
- `Auto-joined voice channel and listening for speaking events` — Overlay voice join
- `Built tokens for 8 characters` — Token configuration loaded
- `WebSocket client disconnected` — Browser client disconnect
- Connection errors, port startup failures

**Why:** Monitors the OBS overlay system and speaking state tracking.

---

### `voice` (INFO default)
**Files:** `src/voice/connection.ts`, `src/voice/speaker.ts`, `src/voice/audioFx.ts`

**Logs:**
- Guild state transitions: `Disconnected → Ready`
- `Reconnected successfully` — Auto-reconnect on network issues
- `Cleaned up speaker for guild` — Playback cleanup
- Player creation, audio errors

**Why:** Tracks voice channel connection health and audio playback.

---

### `voice-reply` (DEBUG gated)
**Files:** `src/voice/voiceReply.ts`

**Debug-level logs:**
- `Meepo asleep, skipping voice reply` — Precondition check
- `Not in voice, skipping voice reply` — Precondition check
- `Meepo speaking, skipping voice reply` — Feedback loop protection
- `Cooldown active (3000ms / 5000ms), skipping` — Rate limit in effect
- `LLM response: "text preview..."` — Generated response preview

**Info-level logs:**
- `Generated and queued reply for guild` — Reply queued for playback
- `Sent text reply (mode=text)` — Text reply sent to Discord

**Why:** Detailed diagnostics for voice reply pipeline debugging. Debug level hides precondition spam at normal INFO level.

---

### `stt` (DEBUG gated)
**Files:** `src/voice/stt/openai.ts`

**Debug-level logs:**
- `OpenAI provider initialized: model=gpt-4o-mini-transcribe, language=en`

**Warn-level logs:**
- `Whisper returned the prompt verbatim; filtering out` — Hallucination detected
- `Transient error (429), retrying in 350ms` — Rate limit or network retry

**Error-level logs:**
- `OpenAI transcription failed (attempt 2, 500)` — Final transcription failure

**Why:** Tracks STT API calls, retries, and hallucination filtering.

---

### `tts` (DEBUG gated)
**Files:** `src/voice/tts/openai.ts`

**Debug-level logs:**
- `OpenAI provider initialized: model=gpt-4o-mini-tts, voice=alloy`
- `Synthesizing 2 chunk(s), total chars=250`
- `Chunk 1/2: "first part of text..."` — Per-chunk progress
- `Synthesis complete: 45000 bytes of MP3 audio`

**Error-level logs:**
- `OpenAI synthesis failed for text "..."` — Synthesis error

**Why:** Monitors TTS chunking and API usage.

---

### `audio-fx` (DEBUG gated)
**Files:** `src/voice/audioFx.ts`

**Debug-level logs:**
- `Disabled` — Audio effects disabled
- `Enabled (pitch=1.05, reverb=true)` — Effects active with parameters

**Error-level logs:**
- `Failed, falling back to raw TTS` — FFmpeg error, using unprocessed audio

**Why:** Tracks optional post-synthesis audio processing.

---

### `meepo` (INFO default)
**Files:** `src/meepo/state.ts`, `src/meepo/autoJoinVoice.ts`, `src/meepo/nickname.ts`, `src/meepo/autoSleep.ts`

**Info-level logs:**
- `Woke up as form_id: meepo` — Startup state
- `Transforming: meepo → xoblob` — Form change
- `Joined General voice channel and started STT` — Auto-join result
- `Sleeping Meepo in guild after 10 minutes of inactivity` — Auto-sleep

**Debug-level logs:**
- `MEEPO_HOME_VOICE_CHANNEL_ID not set, skipping auto-join` — Config missing
- `Already in General voice channel` — Idempotent check
- `Enabled STT for existing connection` — STT activation
- `Nickname set to: Xoblob (Echo)` — Nickname update

**Warn-level logs:**
- `Could not fetch bot guild member for nickname change` — Permission issue

**Why:** Tracks Meepo instance lifecycle and state transitions.

---

### `meepo-mind` (INFO default)
**Files:** `src/ledger/meepo-mind.ts`

**Info-level logs:**
- `Already seeded (all memories present)` — Initial memory check
- `Seeding 5 new memories...` — Memory setup in progress
- `Seeded 5 foundational memories` — Completion

**Error-level logs:**
- `Seeding failed: database error` — Setup failure
- `Retrieval failed: query error` — Query failure
- `Formatting failed: JSON error` — Output formatting error
- `Knowledge check failed: validation error` — Validation failure

**Why:** Tracks the knowledge base initialization and operations.

---

### `ledger` (INFO default)
**Files:** `src/ledger/gptcapProvider.ts`

**Warn-level logs:**
- `File not found: ./data/GPTcaps/beats/beats_C2E6.json`
- `Invalid GPTcap schema in: ./data/.../file.json` — Schema validation failed
- `Error loading ./data/.../file.json` — File parse error

**Why:** Validates and loads GPTcap bootstrap data.

---

### `meeps` (DEBUG + INFO default)
**Files:** `src/commands/meeps.ts`, `src/meeps/meeps.ts`

**Debug-level logs:**
- `/meeps spend invoked: user=alice, id=123456, balance=2`
- `/meeps balance invoked: invoker=alice, target=bob`

**Info-level logs:**
- `Spend: alice (123456) spent 1 meep, balance 2 → 1` — Spend recorded
- `Reward: dm_user awarded 1 meep to Bob (234567), balance 0 → 1` — Reward recorded
- `Created transaction: user=123456, delta=1, issuer=dm, issuer_name=dm_user` — Transaction created

**Why:** Audits all meep transactions for player progression and fairness.

---

## Common Debugging Scenarios

### **Debugging Voice Issues**

```bash
LOG_LEVEL=debug LOG_SCOPES=voice,voice-reply,stt,tts npm run dev:bot
```

**Look for:**
- Voice connection state changes
- STT transcription attempts and retries
- TTS synthesis chunks
- Voice reply precondition failures (asleep, not in voice, etc.)

---

### **Debugging Message Processing & Auto-Wake**

```bash
LOG_LEVEL=debug LOG_SCOPES=boot npm run dev:bot
```

**Look for:**
- `AUTO-WAKE triggered by` — Message woke Meepo
- `Chat transform detected` — Natural language form change detected
- State transition logs

---

### **Debugging Memory System**

```bash
LOG_LEVEL=debug LOG_SCOPES=meepo-mind,ledger npm run dev:bot
```

**Look for:**
- Memory seeding status
- GPTcap file loading
- Knowledge retrieval failures

---

### **Auditing Meep Transactions**

```bash
# Always visible per default config
npm run dev:bot 2>&1 | grep '\[INF\].*meeps'
```

**Look for:**
- Spend transactions (users moving meeps)
- Reward transactions (DMs granting meeps)
- Transaction receipts

---

### **Production Monitoring (Minimal Noise)**

```bash
LOG_LEVEL=warn npm run dev:bot
```

**Shows only:** Warnings, errors, and critical failures (no INFO spam).

---

### **Structured Logging for ELK / Splunk**

```bash
LOG_FORMAT=json npm run dev:bot
```

**Output:** JSON objects with `timestamp`, `level`, `scope`, `message`, `data` fields for ingestion into logging platforms.

---

## Logging Architecture

### Logger Instance
All logging goes through a centralized `Logger` singleton in `src/utils/logger.js`:

```typescript
import { log } from './utils/logger.js';

// Global log with custom scope
log.info("startup message");
log.warn("potential issues", "boot");

// Scoped logger (preferred)
const voiceLog = log.withScope("voice");
voiceLog.debug("connection state changed");
voiceLog.error("audio error");
```

### Log Levels Hierarchy
```
  TRACE (0)    ←  Most verbose
    ↓
  DEBUG (1)
    ↓
  INFO  (2)    ← Default
    ↓
  WARN  (3)
    ↓
  ERROR (4)    ← Most critical
```

Setting `LOG_LEVEL=warn` shows WARN and ERROR. Setting `LOG_LEVEL=trace` shows everything.

### Scope Filtering
- If no `LOG_SCOPES` set (default): **all scopes allowed**
- If `LOG_SCOPES=voice,tts`: **only those scopes log**
- Each log call includes its scope, so filtering works anywhere in the codebase

### Naming Conventions
- Scope names use kebab-case: `voice-reply`, `audio-fx`, `meepo-mind`
- Log messages are sentence-like: "Joined General voice channel..." (not "WARNING: user is in voice")
- Use structured data through the `data` parameter for complex info

---

## Future Logging Enhancements

1. **Meep-triggered rerolls as diegetic events**
   - When `/meeps spend` triggers a reroll, append a system ledger entry:
     ```typescript
     appendLedgerEntry({
       source: "system",
       narrative_weight: "primary",
       content: "[MEEP] Player spent 1 meep to trigger reroll"
     });
     ```

2. **Log archival and rotation**
   - Implement file-based logging with daily log rotation

3. **Correlation IDs**
   - Add session/interaction IDs to link related logs across files

4. **Performance metrics**
   - Add timing logs for LLM calls, API latency, database queries

---

## Testing Your Logging Configuration

```bash
# Check current Python environment logs
LOG_LEVEL=trace npm run dev:bot 2>&1 | head -50

# Filter for a specific scope
npm run dev:bot 2>&1 | grep 'voice'

# Count logs by level
npm run dev:bot 2>&1 | grep -o '\[TRC\]\|\[DBG\]\|\[INF\]\|\[WRN\]\|\[ERR\]' | sort | uniq -c
```

---

## Checklist for Production Deployment

- [ ] Set `LOG_LEVEL=warn` or `LOG_LEVEL=info` (not debug/trace)
- [ ] Leave `LOG_SCOPES` unset (allows all scopes)
- [ ] Use `LOG_FORMAT=json` if sending logs to Splunk/ELK
- [ ] Verify `DEBUG_VOICE` is NOT set (deprecated, may cause issues)
- [ ] Test a sample session with `/meepo wake` + voice command
- [ ] Check logs contain expected INFO-level startup messages
- [ ] Confirm meeps transactions appear in logs (for auditing)

