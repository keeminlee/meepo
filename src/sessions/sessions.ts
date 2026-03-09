import { randomUUID } from "node:crypto";
import { getDbForCampaign } from "../db.js";
import { resolveCampaignSlug } from "../campaign/guildConfig.js";
import { resolveCampaignDbPath } from "../dataPaths.js";
import { enqueueActionIfMissing, REFRESH_STT_PROMPT_ACTION } from "../ledger/meepoContextRepo.js";
import { markRuntimeSessionEnded, markRuntimeSessionStarted } from "./sessionRuntime.js";
import { cfg } from "../config/env.js";
import type { MeepoMode } from "../config/types.js";
import { resolveEffectiveMode, sessionKindForMode } from "./sessionRuntime.js";
import { logRuntimeContextBanner } from "../runtime/runtimeContextBanner.js";
import { log } from "../utils/logger.js";

const sessionLog = log.withScope("session", {
  requireGuildContext: true,
  callsite: "sessions/sessions.ts",
});

export type SessionKind = "canon" | "noncanon";

export type SessionKindStored = SessionKind | "chat";

export type Session = {
  session_id: string;
  guild_id: string;
  kind: SessionKindStored;
  mode_at_start: MeepoMode;
  status?: "active" | "completed" | "interrupted";
  label: string | null;             // User-provided label (e.g., "C2E03") for reference
  created_at_ms: number;            // When session record was created (immutable, for ordering)
  started_at_ms: number;            // When session content began
  ended_at_ms: number | null;
  ended_reason?: string | null;
  started_by_id: string | null;
  started_by_name: string | null;
  source?: string | null;            // 'live' (default) | 'ingest-media' (ingested recordings)
};

export type SessionArtifactType = "megameecap_base" | "recap_final" | "transcript_export";

export type SessionArtifact = {
  id: string;
  session_id: string;
  artifact_type: SessionArtifactType | string;
  created_at_ms: number;
  engine: string | null;
  source_hash: string | null;
  strategy: string;
  strategy_version: string | null;
  meta_json: string | null;
  content_text: string | null;
  file_path: string | null;
  size_bytes: number | null;
};

function normalizeArtifactStrategy(strategy?: string | null): string {
  const value = strategy?.trim();
  return value && value.length > 0 ? value : "default";
}

function getSessionDbForGuild(guildId: string, campaignSlugOverride?: string | null) {
  const campaignSlug = campaignSlugOverride?.trim() || resolveCampaignSlug({ guildId });
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
  const modeAtStart: MeepoMode = opts?.modeAtStart ?? resolveEffectiveMode(guildId);
  const sessionKind: SessionKind = opts?.kind ?? sessionKindForMode(modeAtStart);
  const scopedSessionLog = sessionLog.withContext({
    guild_id: guildId,
    campaign_slug: resolveCampaignSlug({ guildId }),
    session_id: sessionId,
  });

  logRuntimeContextBanner({
    entrypoint: "session:start",
    guildId,
    mode: modeAtStart,
    dbPath,
  });

  db.prepare(
    "INSERT INTO sessions (session_id, guild_id, kind, mode_at_start, status, label, created_at_ms, started_at_ms, ended_at_ms, ended_reason, started_by_id, started_by_name, source) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(sessionId, guildId, sessionKind, modeAtStart, sessionLabel, now, now, null, null, startedById, startedByName, sessionSource);

  try {
    const dedupeKey = [REFRESH_STT_PROMPT_ACTION, guildId, "canon", sessionId, "session_start"].join(":");
    const enqueueResult = enqueueActionIfMissing(db, {
      id: randomUUID(),
      guildId,
      scope: "canon",
      sessionId,
      actionType: REFRESH_STT_PROMPT_ACTION,
      dedupeKey,
      payloadJson: JSON.stringify({ reason: "session_start" }),
      nowMs: now,
      runKind: "online",
      reason: "session_start",
    });

    scopedSessionLog.info("refresh-stt-prompt enqueue at session start", {
      guildId,
      sessionId,
      queued: enqueueResult.queued,
      dedupeKey,
      reason: "session_start",
    });
  } catch (error) {
    scopedSessionLog.warn("Failed to enqueue refresh-stt-prompt action", {
      guildId,
      sessionId,
      error: String((error as any)?.message ?? error ?? "unknown_error"),
    });
  }

  markRuntimeSessionStarted(guildId, sessionId);

  return {
    session_id: sessionId,
    guild_id: guildId,
    kind: sessionKind,
    mode_at_start: modeAtStart,
    status: "active",
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
  const scopedSessionLog = sessionLog.withContext({
    guild_id: guildId,
    campaign_slug: resolveCampaignSlug({ guildId }),
  });
  const now = Date.now();

  const info = db
    .prepare(
      "UPDATE sessions SET ended_at_ms = ?, ended_reason = ?, status = 'completed' WHERE guild_id = ? AND status = 'active'"
    )
    .run(now, reason, guildId);

  if (info.changes > 0) {
    markRuntimeSessionEnded(guildId);
    scopedSessionLog.info("Session ended", {
      ended_reason: reason,
      changes: info.changes,
    });
  }
  return info.changes;
}

export function interruptSessionById(
  guildId: string,
  sessionId: string,
  reason: string | null = "boot_recovery_interrupted"
): number {
  const { db } = getSessionDbForGuild(guildId);
  const scopedSessionLog = sessionLog.withContext({
    guild_id: guildId,
    campaign_slug: resolveCampaignSlug({ guildId }),
    session_id: sessionId,
  });

  const now = Date.now();
  const info = db
    .prepare(
      `
      UPDATE sessions
      SET
        ended_at_ms = COALESCE(ended_at_ms, ?),
        ended_reason = CASE
          WHEN ended_reason IS NULL OR TRIM(ended_reason) = '' THEN ?
          ELSE ended_reason
        END,
        status = 'interrupted'
      WHERE guild_id = ?
        AND session_id = ?
        AND status = 'active'
      `
    )
    .run(now, reason, guildId, sessionId);

  if (info.changes > 0) {
    markRuntimeSessionEnded(guildId);
    scopedSessionLog.info("Session interrupted", {
      ended_reason: reason,
      changes: info.changes,
    });
  }

  return info.changes;
}

export function getActiveSession(guildId: string): Session | null {
  const { db } = getSessionDbForGuild(guildId);
  const row = db
    .prepare("SELECT * FROM sessions WHERE guild_id = ? AND status = 'active' ORDER BY started_at_ms DESC LIMIT 1")
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

export function getMostRecentSession(guildId: string): Session | null {
  const { db } = getSessionDbForGuild(guildId);
  const row = db
    .prepare("SELECT * FROM sessions WHERE guild_id = ? ORDER BY started_at_ms DESC LIMIT 1")
    .get(guildId) as Session | undefined;
  return row ?? null;
}

export function listSessions(guildId: string, limit: number = 10): Session[] {
  const boundedLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
  const { db } = getSessionDbForGuild(guildId);
  const rows = db
    .prepare("SELECT * FROM sessions WHERE guild_id = ? ORDER BY started_at_ms DESC LIMIT ?")
    .all(guildId, boundedLimit) as Session[];
  return rows;
}

export function getSessionById(guildId: string, sessionId: string, campaignSlug?: string | null): Session | null {
  const { db } = getSessionDbForGuild(guildId, campaignSlug);
  const row = db
    .prepare("SELECT * FROM sessions WHERE guild_id = ? AND session_id = ? LIMIT 1")
    .get(guildId, sessionId) as Session | undefined;
  return row ?? null;
}

export function getSessionArtifact(
  guildId: string,
  sessionId: string,
  artifactType: SessionArtifactType | string,
  strategy?: string | null,
  campaignSlug?: string | null
): SessionArtifact | null {
  const { db } = getSessionDbForGuild(guildId, campaignSlug);
  const row =
    strategy == null
      ? (db
          .prepare(
            `
            SELECT sa.*
            FROM session_artifacts sa
            JOIN sessions s ON s.session_id = sa.session_id
            WHERE s.guild_id = ?
              AND sa.session_id = ?
              AND sa.artifact_type = ?
            LIMIT 1
            `
          )
          .get(guildId, sessionId, artifactType) as SessionArtifact | undefined)
      : (db
          .prepare(
            `
            SELECT sa.*
            FROM session_artifacts sa
            JOIN sessions s ON s.session_id = sa.session_id
            WHERE s.guild_id = ?
              AND sa.session_id = ?
              AND sa.artifact_type = ?
              AND sa.strategy = ?
            LIMIT 1
            `
          )
          .get(guildId, sessionId, artifactType, normalizeArtifactStrategy(strategy)) as SessionArtifact | undefined);

  return row ?? null;
}

export function getSessionArtifactsForSession(guildId: string, sessionId: string, campaignSlug?: string | null): SessionArtifact[] {
  const { db } = getSessionDbForGuild(guildId, campaignSlug);
  const rows = db
    .prepare(
      `
      SELECT sa.*
      FROM session_artifacts sa
      JOIN sessions s ON s.session_id = sa.session_id
      WHERE s.guild_id = ?
        AND sa.session_id = ?
      ORDER BY sa.created_at_ms DESC
      `
    )
    .all(guildId, sessionId) as SessionArtifact[];

  return rows;
}

export function getSessionArtifactMap(
  guildId: string,
  sessionIds: string[],
  artifactType: SessionArtifactType | string,
  strategy?: string | null
): Map<string, SessionArtifact> {
  const out = new Map<string, SessionArtifact>();
  if (sessionIds.length === 0) return out;

  const { db } = getSessionDbForGuild(guildId);
  const placeholders = sessionIds.map(() => "?").join(",");
  const rows =
    strategy == null
      ? (db
          .prepare(
            `
            SELECT sa.*
            FROM session_artifacts sa
            JOIN sessions s ON s.session_id = sa.session_id
            WHERE s.guild_id = ?
              AND sa.artifact_type = ?
              AND sa.session_id IN (${placeholders})
            ORDER BY sa.created_at_ms DESC
            `
          )
          .all(guildId, artifactType, ...sessionIds) as SessionArtifact[])
      : (db
          .prepare(
            `
            SELECT sa.*
            FROM session_artifacts sa
            JOIN sessions s ON s.session_id = sa.session_id
            WHERE s.guild_id = ?
              AND sa.artifact_type = ?
              AND sa.strategy = ?
              AND sa.session_id IN (${placeholders})
            `
          )
          .all(guildId, artifactType, normalizeArtifactStrategy(strategy), ...sessionIds) as SessionArtifact[]);

  for (const row of rows) {
    out.set(row.session_id, row);
  }

  return out;
}

export function upsertSessionArtifact(args: {
  guildId: string;
  sessionId: string;
  campaignSlug?: string | null;
  artifactType: SessionArtifactType | string;
  createdAtMs?: number;
  engine?: string | null;
  sourceHash?: string | null;
  strategy?: string | null;
  strategyVersion?: string | null;
  metaJson?: string | null;
  contentText?: string | null;
  filePath?: string | null;
  sizeBytes?: number | null;
}): SessionArtifact {
  const { db } = getSessionDbForGuild(args.guildId, args.campaignSlug);
  const now = args.createdAtMs ?? Date.now();
  const id = randomUUID();
  const strategyKey = normalizeArtifactStrategy(args.strategy);

  db.prepare(
    `
    INSERT INTO session_artifacts (
      id,
      session_id,
      artifact_type,
      created_at_ms,
      engine,
      source_hash,
      strategy,
      strategy_version,
      meta_json,
      content_text,
      file_path,
      size_bytes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id, artifact_type)
    DO UPDATE SET
      created_at_ms = excluded.created_at_ms,
      engine = excluded.engine,
      source_hash = excluded.source_hash,
      strategy = excluded.strategy,
      strategy_version = excluded.strategy_version,
      meta_json = excluded.meta_json,
      content_text = excluded.content_text,
      file_path = excluded.file_path,
      size_bytes = excluded.size_bytes
    `
  ).run(
    id,
    args.sessionId,
    args.artifactType,
    now,
    args.engine ?? null,
    args.sourceHash ?? null,
    strategyKey,
    args.strategyVersion ?? null,
    args.metaJson ?? null,
    args.contentText ?? null,
    args.filePath ?? null,
    args.sizeBytes ?? null
  );

  const row = getSessionArtifact(args.guildId, args.sessionId, args.artifactType, undefined, args.campaignSlug);
  if (!row) {
    throw new Error(`Failed to upsert session artifact: ${args.sessionId}/${args.artifactType}`);
  }
  return row;
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
