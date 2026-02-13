import { randomUUID } from "node:crypto";
import { getDb } from "../db.js";

export type Session = {
  session_id: string;
  guild_id: string;
  label: string | null;             // User-provided label (e.g., "C2E03") for reference
  created_at_ms: number;            // When session record was created (immutable, for ordering)
  started_at_ms: number;            // When session content began
  ended_at_ms: number | null;
  started_by_id: string | null;
  started_by_name: string | null;
  source?: string | null;            // 'live' (default) | 'ingest-media' (ingested recordings)
};

export function startSession(
  guildId: string,
  startedById: string | null = null,
  startedByName: string | null = null,
  opts?: {
    label?: string | null;    // User-provided label (e.g., "C2E03")
    source?: string | null;   // 'live' (default) | 'ingest-media'
  }
): Session {
  const db = getDb();
  const now = Date.now();
  const sessionId = randomUUID();
  const sessionSource = opts?.source ?? "live";
  const sessionLabel = opts?.label ?? null;

  db.prepare(
    "INSERT INTO sessions (session_id, guild_id, label, created_at_ms, started_at_ms, ended_at_ms, started_by_id, started_by_name, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(sessionId, guildId, sessionLabel, now, now, null, startedById, startedByName, sessionSource);

  return {
    session_id: sessionId,
    guild_id: guildId,
    label: sessionLabel,
    created_at_ms: now,
    started_at_ms: now,
    ended_at_ms: null,
    started_by_id: startedById,
    started_by_name: startedByName,
    source: sessionSource,
  };
}

export function endSession(guildId: string): number {
  const db = getDb();
  const now = Date.now();

  const info = db
    .prepare("UPDATE sessions SET ended_at_ms = ? WHERE guild_id = ? AND ended_at_ms IS NULL")
    .run(now, guildId);

  return info.changes;
}

export function getActiveSession(guildId: string): Session | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM sessions WHERE guild_id = ? AND ended_at_ms IS NULL ORDER BY started_at_ms DESC LIMIT 1")
    .get(guildId) as Session | undefined;

  return row ?? null;
}

export function getLatestIngestedSession(guildId: string): Session | null {
  const db = getDb();
  
  // First, try to find ingested session for this specific guild
  // Order by created_at_ms DESC (immutable creation timestamp, most reliable for "latest")
  const row = db
    .prepare("SELECT * FROM sessions WHERE source = 'ingest-media' AND guild_id = ? ORDER BY created_at_ms DESC LIMIT 1")
    .get(guildId) as Session | undefined;

  if (row) {
    return row;
  }

  // Fallback: if no guild-scoped ingested session found, return the latest one regardless of guild
  // (useful for offline testing where ingestion might use guild_id='offline_test')
  // Also ordered by created_at_ms DESC for consistency
  const fallbackRow = db
    .prepare("SELECT * FROM sessions WHERE source = 'ingest-media' ORDER BY created_at_ms DESC LIMIT 1")
    .get() as Session | undefined;

  return fallbackRow ?? null;
}

export function getLatestSessionForLabel(label: string): Session | null {
  const db = getDb();
  
  // Find the most recent session with the given label
  // Ordered by created_at_ms DESC (immutable creation time ensures deterministic "latest")
  const row = db
    .prepare("SELECT * FROM sessions WHERE label = ? ORDER BY created_at_ms DESC LIMIT 1")
    .get(label) as Session | undefined;

  return row ?? null;
}

/**
 * Fetch all ingested sessions, optionally filtered by guild.
 * Returns sessions ordered by created_at_ms DESC (most recent first).
 * 
 * Useful for:
 * - Running batch operations (normalization, meecap generation) on multiple ingests
 * - Gathering all session IDs from a batch of backlog recordings
 * 
 * @param guildId - Optional: filter to specific guild (default: all guilds)
 * @param limit - Optional: max number of sessions to return (default: no limit)
 * @returns Array of ingested sessions, sorted newest-first
 */
export function getIngestedSessions(guildId?: string, limit?: number): Session[] {
  const db = getDb();
  
  let query = "SELECT * FROM sessions WHERE source = 'ingest-media' ORDER BY created_at_ms DESC";
  const params: any[] = [];

  if (guildId) {
    query = "SELECT * FROM sessions WHERE source = 'ingest-media' AND guild_id = ? ORDER BY created_at_ms DESC";
    params.push(guildId);
  }

  if (limit) {
    query += ` LIMIT ${limit}`;
  }

  const rows = db.prepare(query).all(...params) as Session[];
  return rows;
}
