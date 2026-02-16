# MeepoView Overlay System

**Status:** ✅ Complete (February 15, 2026)  
**Purpose:** Real-time speaking indicator overlay for OBS streaming

---

## Overview

The MeepoView overlay is a local web-based system that displays who's speaking in the Discord voice channel. It's designed to be loaded as an OBS Browser Source and shows a bottom bar with 8 character tokens that light up when someone speaks.

### Features

- **Real-time speaking detection** via Discord voice packet monitoring
- **WebSocket-based updates** with automatic reconnection
- **Visual feedback:** Semi-opaque tokens become fully opaque with white outline and bounce animation when speaking
- **Debounced state changes** (400ms) to prevent flickering
- **Independent operation** from Meepo sessions (runs on bot startup)
- **Customizable tokens** via JSON configuration

---

## Architecture

```
Discord Voice Packets
    ↓
Receiver (src/voice/receiver.ts) ← PCM capture + speaking detection
    ↓
Overlay Server (src/overlay/server.ts) ← WebSocket broadcast
    ↓
Overlay HTML (overlay/overlay.html) ← OBS Browser Source
```

### Components

1. **Speaking State Manager** (`src/overlay/speakingState.ts`)
   - Global state tracking for all speakers
   - Debounce timers (400ms on "stop speaking" to prevent flicker)
   - Callback registration for state changes

2. **Overlay Server** (`src/overlay/server.ts`)
   - Express HTTP server on port 7777
   - WebSocket endpoint `/ws` for real-time updates
   - Static routes: `/overlay`, `/tokens.json`, `/static/*`
   - State sync on client connect
   - Broadcast to all connected clients

3. **Overlay Client** (`overlay/overlay.html`)
   - Bottom bar UI with 8 tokens (DM + 6 PCs + Meepo)
   - WebSocket client with exponential backoff reconnect (2s → 5s)
   - CSS bounce animation on active speakers
   - Fallback color generation for missing images

4. **Token Configuration** (`data/overlay/tokens.json`)
   - Maps Discord user IDs to labels and image paths
   - Execution order array for token display

---

## Setup

### 1. Environment Configuration

```env
# .env file
OVERLAY_PORT=7777
OVERLAY_VOICE_CHANNEL_ID=823798700232015886  # Auto-join on bot startup
```

### 2. Token Configuration

Edit `data/overlay/tokens.json`:

```json
{
  "order": ["288025867287003137", "1206767024942432348", ...],
  "tokens": {
    "288025867287003137": {
      "label": "DM",
      "img": "/static/dm.png"
    },
    "1206767024942432348": {
      "label": "Jamison",
      "img": "/static/jamison.png"
    },
    ...
  }
}
```

**Token Images:**
- Place PNG/JPG images in `data/overlay/static/`
- Referenced via `/static/<filename>` in tokens.json
- Recommended: 512x512px transparent PNGs

### 3. OBS Browser Source Setup

1. In OBS, add a **Browser** source
2. Set URL to: `http://localhost:7777/overlay`
3. Width: `1920`, Height: `1080` (or your canvas size)
4. Check ✅ **Shutdown source when not visible** (optional)
5. Check ✅ **Refresh browser when scene becomes active** (optional)

**Recommended OBS Settings:**
- FPS: Custom (30 or matching canvas FPS)
- CSS: None required (styles embedded in HTML)
- Position: Bottom of canvas (overlay uses bottom bar layout)

---

## How It Works

### Speaking Detection

**For Players & DM:**
- Packet-based detection via Discord PCM audio stream
- First packet with audio → emit `speaking: true`
- 150ms silence threshold → start idle timer
- Idle timer expires → emit `speaking: false` (debounced 400ms)

**For Meepo:**
- TTS playback tracking via refcount guard
- Increments on audio chunk queue
- Decrements on playback end
- Emits `speaking: true` when refcount reaches 1
- Emits `speaking: false` when refcount reaches 0

### WebSocket Protocol

**Client → Server:**
- Connection opens: Server responds with `state-sync` message

**Server → Client:**
```json
{
  "type": "state-sync",
  "state": {
    "user_id_1": true,
    "user_id_2": false,
    ...
  }
}
```

```json
{
  "type": "speaking",
  "id": "user_id",
  "speaking": true,
  "t": 1234567890
}
```

### Cleanup on Disconnect

When the bot disconnects or leaves voice:
- `stopReceiver()` clears all pending debounce timers
- Emits `speaking: false` for all tracked speakers
- Overlay tokens return to semi-opaque state

---

## Customization

### CSS Styling

Edit `overlay/overlay.html`:

```css
.token {
  width: 100px;
  height: 100px;
  opacity: 0.4;  /* Semi-opaque when not speaking */
  transition: opacity 0.2s, transform 0.2s;
}

.token.speaking {
  opacity: 1.0;  /* Fully opaque when speaking */
  outline: 3px solid white;
  animation: bounce 0.5s ease-in-out infinite;
}
```

### Debounce Timing

Edit `src/overlay/speakingState.ts`:

```typescript
// Line ~40
setTimeout(() => {
  // ... emit false
}, 400);  // Increase for less sensitivity
```

### WebSocket Reconnect

Edit `overlay/overlay.html`:

```javascript
let reconnectDelay = 2000;    // Initial delay
const maxReconnectDelay = 5000; // Max backoff
```

---

## Troubleshooting

### Tokens not appearing
- Check `data/overlay/tokens.json` exists and is valid JSON
- Verify token IDs match Discord user IDs
- Check browser console for fetch errors (`http://localhost:7777/tokens.json`)

### Overlay not updating
- Verify WebSocket connection in browser console
- Check bot is connected to `OVERLAY_VOICE_CHANNEL_ID`
- Ensure receiver is running: look for `[Voice] Starting receiver` in bot logs

### Tokens stuck "speaking"
- Check bot disconnect/reconnect in Discord
- Verify `stopReceiver()` is being called on leave
- Browser refresh will force state sync

### Images not loading
- Check file paths in `tokens.json` match files in `data/overlay/static/`
- Ensure images are accessible at `http://localhost:7777/static/<filename>`
- Fallback: Remove `img` property to use colored circles

---

## Integration Points

### Receiver Integration
`src/voice/receiver.ts`:
```typescript
updateOverlaySpeakingActivity(guildId, userId)  // On PCM packet
clearOverlaySpeakingState(guildId, userId)      // On finalize
```

### Speaker Integration
`src/voice/speaker.ts`:
```typescript
overlayEmitSpeaking("meepo", true)   // TTS playback start
overlayEmitSpeaking("meepo", false)  // TTS playback end
```

### Server Exports
`src/overlay/server.ts`:
```typescript
export function overlayEmitSpeaking(id: string, speaking: boolean)
export async function startOverlayServer()
```

---

## Performance

- **HTTP Server:** Minimal overhead (Express static routes)
- **WebSocket:** ~50 bytes per speaking event
- **Client CPU:** <1% (CSS animations only)
- **Network:** WebSocket reconnect with backoff prevents spam

---

## Future Enhancements

- [ ] Token position customization (top/bottom/side)
- [ ] Multiple overlay layouts (grid, circle, horizontal)
- [ ] Per-token volume meters
- [ ] Speaking duration timers
- [ ] Theme system (colors, fonts, sizes)
- [ ] Remote configuration (REST API for tokens.json updates)
