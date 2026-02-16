/**
 * Overlay Server: HTTP + WebSocket
 * Serves token bar webpage and broadcasts speaking events
 */

import express, { Router, Request, Response } from 'express';
import { createServer, Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as path from 'path';
import { setSpeaking, getSpeakingState, onSpeakingStateChange, setPresence, getPresenceState, onPresenceStateChange } from './speakingState.js';
import { loadRegistry } from '../registry/loadRegistry.js';

const app = express();
let httpServer: HttpServer | null = null;
let wss: WebSocketServer | null = null;

const overlayPort = parseInt(process.env.OVERLAY_PORT || '7777', 10);
const dmRoleId = process.env.DM_ROLE_ID || '';

// In-memory broadcast queue (buffer messages if no active connections)
const activeBroadcasters = new Set<WebSocket>();

/**
 * Build token configuration from registry
 * Returns {order: [...], tokens: {...}} structure
 */
function buildTokensFromRegistry() {
  const registry = loadRegistry();
  const tokens: Record<string, { label: string; img: string }> = {};
  const order: string[] = [];

  // Add DM token first
  if (dmRoleId) {
    tokens[dmRoleId] = {
      label: 'DM',
      img: '/static/tokens/dm.png',
    };
    order.push(dmRoleId);
    console.log(`[Overlay] Added DM token: ${dmRoleId}`);
  }

  // Add PC tokens from registry (sorted by canonical name)
  const pcs = registry.characters.filter(c => c.type === 'pc').sort((a, b) => a.canonical_name.localeCompare(b.canonical_name));
  for (const pc of pcs) {
    if (pc.discord_user_id) {
      const tokenName = pc.canonical_name.toLowerCase().replace(/\s+/g, '_');
      tokens[pc.discord_user_id] = {
        label: pc.canonical_name,
        img: `/static/tokens/${tokenName}.png`,
      };
      order.push(pc.discord_user_id);
      console.log(`[Overlay] Added PC token: ${pc.canonical_name} (${pc.discord_user_id})`);
    }
  }

  // Add Meepo token last
  tokens['meepo'] = {
    label: 'Meepo',
    img: '/static/tokens/meepo.png',
  };
  order.push('meepo');

  console.log(`[Overlay] Built tokens for ${order.length} characters`);
  return { order, tokens };
}

/**
 * Setup routes for the overlay server
 */
function setupRoutes(router: Router) {
  // Serve overlay.html
  router.get('/overlay', (req: Request, res: Response) => {
    const overlayPath = path.join(process.cwd(), 'overlay', 'overlay.html');
    res.sendFile(overlayPath);
  });

  // Serve tokens.json (dynamically loaded from registry)
  router.get('/tokens.json', (req: Request, res: Response) => {
    try {
      const tokens = buildTokensFromRegistry();
      res.json(tokens);
    } catch (error) {
      console.error('[Overlay] Failed to build tokens:', error);
      res.status(500).json({ error: 'Failed to load tokens' });
    }
  });

  // Serve static assets (images, etc.)
  router.use('/static', express.static(path.join(process.cwd(), 'overlay', 'static')));

  app.use(router);
}

/**
 * Send message to all connected WebSocket clients
 */
function broadcastToClients(message: Record<string, unknown>) {
  if (!wss) return;

  const data = JSON.stringify(message);
  let sentCount = 0;

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
      sentCount++;
    }
  });
}

/**
 * Handle new WebSocket connection
 * Send state sync on connect
 */
function setupWebSocket() {
  if (!httpServer) return;

  wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws: WebSocket) => {
    activeBroadcasters.add(ws);

    // Send current speaking and presence state to new client
    const currentSpeakingState = getSpeakingState();
    const currentPresenceState = getPresenceState();
    const stateSync = {
      type: 'state-sync',
      speaking: Object.fromEntries(currentSpeakingState),
      presence: Object.fromEntries(currentPresenceState),
    };
    ws.send(JSON.stringify(stateSync));

    ws.on('close', () => {
      console.log('[Overlay] WebSocket client disconnected');
      activeBroadcasters.delete(ws);
    });

    ws.on('error', (error) => {
      console.error('[Overlay] WebSocket error:', error);
    });
  });
}

/**
 * Start the overlay server
 * Call this early in bot startup (before Discord init, independent)
 */
export async function startOverlayServer() {
  return new Promise<void>((resolve) => {
    httpServer = createServer(app);
    const router = Router();

    setupRoutes(router);
    setupWebSocket();

    // Listen for speaking state changes and broadcast
    onSpeakingStateChange((id: string, speaking: boolean) => {
      broadcastToClients({
        type: 'speaking',
        id,
        speaking,
        t: Date.now(),
      });
    });

    // Listen for presence state changes and broadcast
    onPresenceStateChange((id: string, present: boolean) => {
      broadcastToClients({
        type: 'presence',
        id,
        present,
        t: Date.now(),
      });
    });

    httpServer.listen(overlayPort, () => {
      console.log(`[Overlay] http://localhost:${overlayPort}/overlay`);
      resolve();
    });
  });
}

/**
 * Emit speaking event for a token
 * Should be called from receiver (DM/PCs) and speaker (Meepo)
 */
export function overlayEmitSpeaking(id: string, speaking: boolean) {
  setSpeaking(id, speaking);
}

/**
 * Emit presence event for a token
 * Should be called from voiceStateUpdate handler when users join/leave voice
 */
export function overlayEmitPresence(id: string, present: boolean) {
  setPresence(id, present);
}

/**
 * Stop overlay server (cleanup)
 */
export async function stopOverlayServer() {
  if (wss) {
    wss.clients.forEach((client) => client.close());
    wss.close();
  }
  if (httpServer) {
    httpServer.close();
  }
}
