/**
 * Overlay Server: HTTP + WebSocket
 * Serves token bar webpage and broadcasts speaking events
 */

import express, { Router, Request, Response } from 'express';
import { createServer, Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as path from 'path';
import { setSpeaking, getSpeakingState, onSpeakingStateChange } from './speakingState.js';

const app = express();
let httpServer: HttpServer | null = null;
let wss: WebSocketServer | null = null;

const overlayPort = parseInt(process.env.OVERLAY_PORT || '7777', 10);

// In-memory broadcast queue (buffer messages if no active connections)
const activeBroadcasters = new Set<WebSocket>();

/**
 * Setup routes for the overlay server
 */
function setupRoutes(router: Router) {
  // Serve overlay.html
  router.get('/overlay', (req: Request, res: Response) => {
    const overlayPath = path.join(process.cwd(), 'overlay', 'overlay.html');
    res.sendFile(overlayPath);
  });

  // Serve tokens.json
  router.get('/tokens.json', (req: Request, res: Response) => {
    const tokensPath = path.join(process.cwd(), 'data', 'overlay', 'tokens.json');
    res.sendFile(tokensPath);
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

    // Send current speaking state to new client
    const currentState = getSpeakingState();
    const stateSync = {
      type: 'state-sync',
      tokens: Object.fromEntries(currentState),
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
