# MeepoView Overlay System

**Status:** ✅ Shipping in V0 (February 15, 2026)  
**Purpose:** Real-time speaking & presence indicator overlay for OBS streaming

---

## Overview

The MeepoView overlay is a **streaming-first UI** for broadcasting D&D sessions with dynamic character tokens. It displays:
- **Adaptive Token Bar:** Shows only characters actively in the Discord voice channel
- **Speaking Indicators:** Real-time glow + bounce when users speak
- **Registry-Driven:** Tokens dynamically loaded from `pcs.yml` (single source of truth)
- **Scaled for Visibility:** 140px tokens with 28px gaps for better OBS presence

### Key Features

- ✅ **Adaptive Presence Tracking:** Tokens show/hide based on voiceStateUpdate events (who's in voice)
- ✅ **Real-time Speaking Detection:** Voice packets + TTS playback tracked with 400ms debounce
- ✅ **Dynamic Token Loading:** No static config file — built from pcs.yml registry on each request
- ✅ **WebSocket Broadcasting:** Presence and speaking state pushed to all connected clients
- ✅ **Auto-Reconnection:** Browser client automatically reconnects if connection drops
- ✅ **Fallback Rendering:** Placeholder colors if token images missing

---

## Architecture

```
Discord Events & Voice Packets
    ↓
Server (src/overlay/server.ts)
  ├─ HTTP: Serve overlay.html + /tokens.json
  ├─ Registry: Load pcs.yml, build token config dynamically
  ├─ voiceStateUpdate Handler: Track joins/leaves
  ├─ WebSocket: Broadcast speaking & presence state
  └─ State Management: speakingState.ts (debounced + presence-aware)
    ↓
Browser Client (overlay/overlay.html)
  ├─ Load tokens via /tokens.json
  ├─ Connect WebSocket for real-time updates
  ├─ Render CSS-based token bar
  └─ Display in OBS (automatic reconnect if network blips)
```

### Components

1. **Speaking State Manager** (`src/overlay/speakingState.ts`)
   - Speaking state tracking with 400ms debounce (prevent flicker)
   - Presence state tracking (true if in voice channel)
   - Callbacks for state changes (broadcast via WebSocket)
   - Auto-clear speaking when user leaves voice

2. **Overlay Server** (`src/overlay/server.ts`)
   - Express HTTP server on port configured by `OVERLAY_PORT`
   - Routes:
     - `GET /overlay` → Serve overlay.html
     - `GET /tokens.json` → Build config from pcs.yml registry dynamically
     - `GET /static/*` → Token images
   - WebSocket `/ws` for real-time state broadcasts
   - State sync on client connect (speaking + presence states)
   - Listeners for state changes, broadcast to all connected clients

3. **Overlay Client** (`overlay/overlay.html`)
   - Bottom bar UI with token layout (DM first, PCs alphabetical, Meepo last)
   - WebSocket client with exponential backoff (2s → 5s max)
   - CSS animations: opacity, glow, bounce
   - Presence management: tokens hidden by default, shown on presence=true
   - Console logging for debugging

4. **Registry Integration** (`data/registry/pcs.yml`)
   - Source of truth for all characters
   - Each PC has `discord_user_id` and `canonical_name`
   - Token images auto-referenced: lowercase + underscores (Jamison → jamison.png)

---

## Setup

### 1. Environment Configuration

```env
# Required in .env
OVERLAY_PORT=7777                       # HTTP + WebSocket server port
OVERLAY_VOICE_CHANNEL_ID=<channel_id>   # Voice channel to auto-join on bot startup
DM_ROLE_ID=<role_id>                    # Optional: Discord role for DM token
```

### 2. Registry Setup

Ensure `data/registry/pcs.yml` has all player characters with `discord_user_id`:

```yaml
characters:
  - canonical_name: "Jamison"
    discord_user_id: "123456789"
    type: "pc"
    
  - canonical_name: "Snowflake"
    discord_user_id: "987654321"
    type: "pc"
```

**Token Images:**
- Place PNG/JPG files in `overlay/static/tokens/`
- Filename derived from canonical_name (lowercase, spaces→underscores)
- Examples:
  - "Jamison" → `jamison.png`
  - "Old Xoblob" → `old_xoblob.png`
  - "Meepo" → `meepo.png` (always auto-included)
- Recommended: 512x512px transparent PNGs

### 3. OBS Browser Source Setup

1. In OBS, add a **Browser** source
2. Set URL to: `http://localhost:7777/overlay`
3. Width: `1920`, Height: `300` (adjust for your layout)
4. ✅ **Shutdown source when not visible** (optional)
5. ✅ **Refresh browser when scene becomes active** (recommended)

**Positioning:**
- Bottom-left or bottom-right corner of canvas
- Test by joining voice channel to see tokens appear

---

## How It Works

### 1. Token Loading

When browser loads overlay.html:

```javascript
// GET http://localhost:7777/tokens.json
{
  "order": ["<dm_role_id>", "<user_id_1>", "<user_id_2>", "meepo"],
  "tokens": {
    "<dm_role_id>": { "label": "DM", "img": "/static/tokens/dm.png" },
    "<user_id_1>": { "label": "Jamison", "img": "/static/tokens/jamison.png" },
    "meepo": { "label": "Meepo", "img": "/static/tokens/meepo.png" }
  }
}
```

**No static config file needed** — tokens generated dynamically from pcs.yml.

### 2. Presence Tracking

**Discord Event:** `voiceStateUpdate`

```typescript
// When user joins overlay voice channel
if (newState.channelId === OVERLAY_VOICE_CHANNEL_ID) {
  overlayEmitPresence(userId, true);   // ← Cause show token
}

// When user leaves overlay voice channel
if (oldState.channelId === OVERLAY_VOICE_CHANNEL_ID) {
  overlayEmitPresence(userId, false);  // ← Cause hide token
}
```

**Initial Setup:**
- On bot startup, iterator over existing channel members and emit presence=true
- Set Meepo's presence=true when joining
- Set Meepo's presence=false when disconnecting

### 3. Speaking Detection

**Two Sources:**

1. **Receiver (voice packets):** Audio activity from Discord users in voice
   - Triggered on PCM packets with amplitude >-40dB
   - First packet → emit `speaking=true`
   - 150ms silence threshold → emit `speaking=false` (debounced 400ms)

2. **Speaker (TTS output):** Meepo's text-to-speech
   - Tracked via refcount guard (increment on queue, decrement on finish)
   - Emit `speaking=true` when first chunk queued
   - Emit `speaking=false` when last chunk finishes

### 4. WebSocket Broadcasting

**Messages from Server:**

```json
{
  "type": "state-sync",
  "speaking": {"user1": false, "meepo": true},
  "presence": {"user1": true, "meepo": true}
}
```

Sent on client connect with current state snapshot.

```json
{
  "type": "speaking",
  "id": "user1",
  "speaking": true,
  "t": 1234567890
}
```

Sent whenever speaking state changes.

```json
{
  "type": "presence",
  "id": "user1",
  "present": true,
  "t": 1234567890
}
```

Sent whenever presence state changes (user joins/leaves voice).

### 5. Client-Side Rendering

```javascript
// Tokens default to display: none
function setPresence(id, present) {
  if (present) {
    tokenElements[id].style.display = 'flex';   // ← Show
  } else {
    tokenElements[id].style.display = 'none';   // ← Hide
    setSpeaking(id, false);                      // Clear speaking state
  }
}

// Add glow + bounce when speaking
function setSpeaking(id, speaking) {
  if (speaking) {
    tokenElements[id].classList.add('speaking');
  } else {
    tokenElements[id].classList.remove('speaking');
  }
}
```

---

## File Structure

```
overlay/
├── overlay.html              # Browser client (CSS + JS, user-facing)
└── static/
    └── tokens/
        ├── dm.png           # DM token image
        ├── jamison.png      # PC token images (auto-loaded from pcs.yml)
        ├── snowflake.png
        ├── meepo.png        # Meepo token image
        └── ...

src/overlay/
├── server.ts                 # HTTP + WebSocket server
│   ├── startOverlayServer()
│   ├── buildTokensFromRegistry()  # NEW: Dynamic token builder
│   ├── overlayEmitSpeaking()
│   ├── overlayEmitPresence()      # NEW: Presence broadcast
│   └── setupWebSocket()
└── speakingState.ts          # Debounced state management
    ├── setSpeaking()
    ├── setPresence()              # NEW: Presence tracking
    ├── getSpeakingState()
    ├── getPresenceState()          # NEW: Query presence
    ├── onSpeakingStateChange()
    └── onPresenceStateChange()     # NEW: Presence callbacks
```

---

## Customization

### Change Token Sizes

Edit `overlay/overlay.html`:

```css
.token-image {
  width: 140px;      /* Current: 140px */
  height: 140px;     /* Current: 140px */
  border-radius: 12px;
}

.token-label {
  font-size: 18px;   /* Current: 18px */
  min-width: 140px;
}

.token-bar {
  gap: 28px;         /* Current: 28px */
  padding: 28px 40px;/* Current: 28px top/bottom, 40px left/right */
}
```

### Change Colors/Glows

```css
.token-image {
  opacity: 0.45;     /* Idle: semi-opaque */
}

.token.speaking .token-image {
  opacity: 1.0;      /* Speaking: fully opaque */
  outline: 4px solid rgba(255, 255, 255, 0.9);  /* White glow */
  outline-offset: 4px;
}
```

### Change Animation

```css
@keyframes bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-12px); }  /* Bounce height */
}
```

### Change Speaking Debounce

Edit `src/overlay/speakingState.ts`:

```typescript
const SPEAKING_OFF_DEBOUNCE_MS = 400;  // Increase for stickiness, decrease for responsiveness
```

### Change WebSocket Reconnect Timing

Edit `overlay/overlay.html`:

```javascript
const WS_RECONNECT_DELAY_MS = 2000;      // Initial: 2 seconds
const WS_RECONNECT_MAX_DELAY_MS = 5000;  // Max: 5 seconds
```

### Change Token Order

Edit `src/overlay/server.ts` in `buildTokensFromRegistry()`:

```typescript
// Current order: DM first, PCs alphabetical, Meepo last
// Modify the push order to customize:
order.push(dmRoleId);                           // DM first
pcs.forEach(pc => order.push(pc.discord_user_id));  // PCs
order.push('meepo');                            // Meepo last

// Or sort PCs differently, exclude DM, etc.
```

---

## Troubleshooting

### Overlay blank when I join voice

1. **Check tokens.json generation:**
   ```bash
   curl http://localhost:7777/tokens.json | python -m json.tool
   ```
   Should return valid JSON with "order" and "tokens" keys.

2. **Check registry loaded:**
   Bot logs should show:
   ```
   [Overlay] Added DM token: <id>
   [Overlay] Added PC token: Jamison (<id>)
   [Overlay] Built tokens for 8 characters
   ```

3. **Check WebSocket connection:**
   Browser console → check for WebSocket URL and connection status
   Should see: `wss://localhost:7777/ws` or `ws://localhost:7777/ws`

4. **Check initial presence:**
   Bot logs should show:
   ```
   [Overlay] Initial presence: Jamison (user_id)
   [Overlay] Set Meepo presence: true
   ```

### Tokens appear but don't disappear when leaving voice

1. Check voiceStateUpdate is being triggered:
   Bot logs should show:
   ```
   [Overlay] User <id> left voice channel
   ```

2. Check presence broadcast:
   Browser console should show:
   ```
   [Overlay] Presence: <id> = false
   ```

3. Verify Discord configuration has correct `OVERLAY_VOICE_CHANNEL_ID`

### Tokens don't glow when speaking

1. **Verify receiver is running:**
   Bot logs should show:
   ```
   [Voice] Starting receiver
   ```

2. **Check audio activity:**
   Try speaking louder or adjusting noise gate in env:
   ```env
   VOICE_SILENCE_THRESHOLD_DB=-30  # More aggressive (fewer false negatives)
   ```

3. **Check WebSocket receives speaking events:**
   Browser console should show:
   ```
   [Overlay] Received message: { type: 'speaking', id: '...', speaking: true }
   ```

### Token images not loading

1. Check images exist in `overlay/static/tokens/`:
   ```bash
   ls overlay/static/tokens/
   ```

2. Check filenames match registry canonical names:
   - `canonical_name: "Jamison"` → file must be `jamison.png`
   - Spaces become underscores: `"Old Xoblob"` → `old_xoblob.png`

3. Verify HTTP serving:
   ```bash
   curl http://localhost:7777/static/tokens/jamison.png
   ```
   Should return PNG binary data (not 404)

4. Browser fallback: If image fails to load, should show colored placeholder with initials

### Browser console errors

1. **CORS errors:** Already preconfigured in server.ts
2. **WebSocket connection refused:** Check bot is running and OVERLAY_PORT is accessible
3. **Null tokenElements[id]:** Token not rendered — check /tokens.json has user ID

---

## Integration Points from Recent Commits

**src/bot.ts:**
- On `ready` event: Auto-join overlay voice channel, set initial presence for members + Meepo
- On `voiceStateUpdate` event: Track joins/leaves, call `overlayEmitPresence(userId, true/false)`

**src/commands/meepo.ts:**
- On `/meepo join` command: Call `overlayEmitPresence("meepo", true)` to show Meepo token

**src/voice/connection.ts:**
- On `leaveVoice()`: Call `overlayEmitPresence("meepo", false)` to hide Meepo token
- On voice connection destroyed: Call `overlayEmitPresence("meepo", false)` to ensure cleanup

**src/voice/receiver.ts:**
- On voice activity detected: Call `overlayEmitSpeaking(userId, true)`
- On utterance timeout: Call `overlayEmitSpeaking(userId, false)` (debounced)

**src/voice/speaker.ts:**
- On TTS playback start: Call `overlayEmitSpeaking("meepo", true)`
- On TTS playback end: Call `overlayEmitSpeaking("meepo", false)`

---

## Performance Notes

- **HTTP:** Minimal overhead (registry load on each /tokens.json request, cached in memory)
- **WebSocket:** One persistent connection per browser, broadcasts only on state changes
- **Client Rendering:** Pure CSS (GPU accelerated), no JavaScript animations
- **Network Overhead:** <1KB/sec idle, <5KB/sec during speaking
- **CPU Usage:** Browser <1%, server negligible
- **Debounce Timers:** Single timer per speaker to prevent flicker

---

## Future Enhancements

- [ ] Persona-based token color coding (Meepo green, Xoblob red, etc.)
- [ ] Microphone mute indicator (integrated with Discord mute state)
- [ ] Character stat bars (health, inspiration, etc.)
- [ ] Custom per-persona token animations
- [ ] Multi-layer overlay (characters, NPCs, etc. on separate layers)
- [ ] Theme system (colors, fonts, layout configurations)
- [ ] Remote configuration API (update tokens without restart)

---

## Implementation Summary (Feb 15, 2026)

**What Changed:**
- Added voiceStateUpdate handler in bot.ts to track Discord membership
- Implemented presence state tracking parallel to speaking state
- Refactored /tokens.json to build dynamically from pcs.yml
- Scaled token assets 75% larger (80px→140px)
- Added console logging for debugging presence flow

**Architecture Decisions:**
- Presence is binary (true/false), matching speaking state model
- Registry loaded at request time (ensures fresh data, no stale cache)
- Meepo is special case: string ID "meepo", never tied to Discord member
- No static tokens.json file — fully generated from source of truth
- State sync on WebSocket connect ensures clients get current state

**Now Generalizable:**
- Add new PC to pcs.yml with discord_user_id
- Add PNG to overlay/static/tokens/{canonical_name_lowercase}.png
- No code changes needed — overlay dynamically picks up new character
