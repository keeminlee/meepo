import { randomUUID } from "node:crypto";
import { getDbForCampaign } from "../db.js";
import { resolveCampaignSlug } from "../campaign/guildConfig.js";
import { resolveCampaignDbPath } from "../dataPaths.js";
import { setActiveSessionId, clearActiveSessionId } from "./sessionRuntime.js";
import { cfg } from "../config/env.js";
import type { MeepoMode } from "../config/types.js";
import { sessionKindForMode } from "./sessionRuntime.js";
import { logRuntimeContextBanner } from "../runtime/runtimeContextBanner.js";

export type SessionKind = "canon" | "chat";

export type Session = {
  session_id: string;
  guild_id: string;
  kind: SessionKind;
  mode_at_start: MeepoMode;
  label: string | null;             // User-provided label (e.g., "C2E03") for reference
  created_at_ms: number;            // When session record was created (immutable, for ordering)
  started_at_ms: number;            // When session content began
  ended_at_ms: number | null;
  ended_reason?: string | null;
  started_by_id: string | null;
  started_by_name: string | null;
  source?: string | null;            // 'live' (default) | 'ingest-media' (ingested recordings)
};

function getSessionDbForGuild(guildId: string) {
  const campaignSlug = resolveCampaignSlug({ guildId });
  return {
    campaignSlug,
    dbPath: resolveCampaignDbPath(campaignSlug),
    db: getDbForCampaign(campaignSlug),
  };
}

export function startSession(
  guildId: string,
  startedById: string | null = null,
  startedByName: string | null = null,
  opts?: {
    label?: string | null;    // User-provided label (e.g., "C2E03")
    source?: string | null;   // 'live' (default) | 'ingest-media'
    kind?: SessionKind;
    modeAtStart?: MeepoMode;
  }
): Session {
  const { db, dbPath } = getSessionDbForGuild(guildId);
  const now = Date.now();
  const sessionId = randomUUID();
  const sessionSource = opts?.source ?? "live";
  const sessionLabel = opts?.label ?? null;
  const normalizedLabel = (sessionLabel ?? "").trim().toLowerCase();
  const inferredModeAtStart: MeepoMode = normalizedLabel.includes("test")
    ? "lab"
    : normalizedLabel === "chat"
      ? "ambient"
      : opts?.modeAtStart ?? cfg.mode;
  const modeAtStart: MeepoMode = inferredModeAtStart;
  const sessionKind: SessionKind = opts?.kind ?? sessionKindForMode(modeAtStart);

  logRuntimeContextBanner({
    entrypoint: "session:start",
    guildId,
    mode: modeAtStart,
    dbPath,
  });

  db.prepare(
    "INSERT INTO sessions (session_id, guild_id, kind, mode_at_start, label, created_at_ms, started_at_ms, ended_at_ms, ended_reason, started_by_id, started_by_name, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(sessionId, guildId, sessionKind, modeAtStart, sessionLabel, now, now, null, null, startedById, startedByName, sessionSource);

  setActiveSessionId(guildId, sessionId);

  return {
    session_id: sessionId,
    guild_id: guildId,
    kind: sessionKind,
    mode_at_start: modeAtStart,
    label: sessionLabel,
    created_at_ms: now,
    started_at_ms: now,
    ended_at_ms: null,
    started_by_id: startedById,
    started_by_name: startedByName,
    source: sessionSource,
  };
}

export function endSession(guildId: string, reason: string | null = null): number {
  const { db } = getSessionDbForGuild(guildId);
  const now = Date.now();

  const info = db
    .prepare("UPDATE sessions SET ended_at_ms = ?, ended_reason = ? WHERE guild_id = ? AND ended_at_ms IS NULL")
    .run(now, reason, guildId);

  if (info.changes > 0) {
    clearActiveSessionId(guildId);
  }
  return info.changes;
}

export function getActiveSession(guildId: string): Session | null {
  const { db } = getSessionDbForGuild(guildId);
  const row = db
    .prepare("SELECT * FROM sessions WHERE guild_id = ? AND ended_at_ms IS NULL ORDER BY started_at_ms DESC LIMIT 1")
    .get(guildId) as Session | undefined;

  return row ?? null;
}

export function getLatestIngestedSession(guildId: string): Session | null {
  const { db } = getSessionDbForGuild(guildId);
  const row = db
    .prepare("SELECT * FROM sessions WHERE source = 'ingest-media' AND guild_id = ? ORDER BY created_at_ms DESC LIMIT 1")
    .get(guildId) as Session | undefined;
  return row ?? null;
}

export function getLatestSessionForLabel(label: string, guildId?: string): Session | null {
  if (!guildId) return null;
  const { db } = getSessionDbForGuild(guildId);
  const row = guildId
    ? (db
        .prepare("SELECT * FROM sessions WHERE label = ? AND guild_id = ? ORDER BY created_at_ms DESC LIMIT 1")
        .get(label, guildId) as Session | undefined)
    : (db
        .prepare("SELECT * FROM sessions WHERE label = ? ORDER BY created_at_ms DESC LIMIT 1")
        .get(label) as Session | undefined);

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
  if (!guildId) {
    return [];
  }
  const { db } = getSessionDbForGuild(guildId);
  
  let query = "SELECT * FROM sessions WHERE source = 'ingest-media' ORDER BY created_at_ms DESC";
  const params: any[] = [];

  query = "SELECT * FROM sessions WHERE source = 'ingest-media' AND guild_id = ? ORDER BY created_at_ms DESC";
  params.push(guildId);

  if (limit) {
    query += ` LIMIT ${limit}`;
  }

  const rows = db.prepare(query).all(...params) as Session[];
  return rows;
}
