import { getDbForCampaign } from "../db.js";
import { resolveCampaignSlug } from "../campaign/guildConfig.js";
import { getSessionById } from "./sessions.js";

export type SessionRecapViews = {
  concise: string;
  balanced: string;
  detailed: string;
};

export type SessionRecap = {
  sessionId: string;
  guildId: string;
  campaignSlug: string;
  createdAtMs: number;
  updatedAtMs: number;
  engine: string | null;
  sourceHash: string | null;
  strategyVersion: string | null;
  metaJson: string | null;
  views: SessionRecapViews;
};

export type UpsertSessionRecapArgs = {
  guildId: string;
  sessionId: string;
  createdAtMs?: number;
  updatedAtMs?: number;
  engine?: string | null;
  sourceHash?: string | null;
  strategyVersion?: string | null;
  metaJson?: string | null;
  views: SessionRecapViews;
};

type SessionRecapRow = {
  session_id: string;
  created_at_ms: number;
  updated_at_ms: number;
  engine: string | null;
  source_hash: string | null;
  strategy_version: string | null;
  meta_json: string | null;
  concise_text: string;
  balanced_text: string;
  detailed_text: string;
};

function getRecapDbForGuild(guildId: string) {
  const campaignSlug = resolveCampaignSlug({ guildId });
  return {
    campaignSlug,
    db: getDbForCampaign(campaignSlug),
  };
}

function mapRowToSessionRecap(row: SessionRecapRow, guildId: string, campaignSlug: string): SessionRecap {
  return {
    sessionId: row.session_id,
    guildId,
    campaignSlug,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    engine: row.engine,
    sourceHash: row.source_hash,
    strategyVersion: row.strategy_version,
    metaJson: row.meta_json,
    views: {
      concise: row.concise_text,
      balanced: row.balanced_text,
      detailed: row.detailed_text,
    },
  };
}

export function getSessionRecap(guildId: string, sessionId: string): SessionRecap | null {
  const { db, campaignSlug } = getRecapDbForGuild(guildId);
  const session = getSessionById(guildId, sessionId);
  if (!session) {
    return null;
  }

  const row = db
    .prepare(
      `
      SELECT session_id, created_at_ms, updated_at_ms, engine, source_hash, strategy_version, meta_json,
             concise_text, balanced_text, detailed_text
      FROM session_recaps
      WHERE session_id = ?
      LIMIT 1
      `
    )
    .get(sessionId) as SessionRecapRow | undefined;

  return row ? mapRowToSessionRecap(row, guildId, campaignSlug) : null;
}

export function upsertSessionRecap(args: UpsertSessionRecapArgs): SessionRecap {
  const { db, campaignSlug } = getRecapDbForGuild(args.guildId);
  const session = getSessionById(args.guildId, args.sessionId);
  if (!session) {
    throw new Error(`Session not found: ${args.sessionId}`);
  }

  const now = Date.now();
  const createdAtMs = args.createdAtMs ?? now;
  const updatedAtMs = args.updatedAtMs ?? now;

  db.prepare(
    `
    INSERT INTO session_recaps (
      session_id,
      created_at_ms,
      updated_at_ms,
      engine,
      source_hash,
      strategy_version,
      meta_json,
      concise_text,
      balanced_text,
      detailed_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id)
    DO UPDATE SET
      created_at_ms = session_recaps.created_at_ms,
      updated_at_ms = excluded.updated_at_ms,
      engine = excluded.engine,
      source_hash = excluded.source_hash,
      strategy_version = excluded.strategy_version,
      meta_json = excluded.meta_json,
      concise_text = excluded.concise_text,
      balanced_text = excluded.balanced_text,
      detailed_text = excluded.detailed_text
    `
  ).run(
    args.sessionId,
    createdAtMs,
    updatedAtMs,
    args.engine ?? null,
    args.sourceHash ?? null,
    args.strategyVersion ?? null,
    args.metaJson ?? null,
    args.views.concise,
    args.views.balanced,
    args.views.detailed
  );

  const row = db
    .prepare(
      `
      SELECT session_id, created_at_ms, updated_at_ms, engine, source_hash, strategy_version, meta_json,
             concise_text, balanced_text, detailed_text
      FROM session_recaps
      WHERE session_id = ?
      LIMIT 1
      `
    )
    .get(args.sessionId) as SessionRecapRow | undefined;

  if (!row) {
    throw new Error(`Failed to upsert session recap: ${args.sessionId}`);
  }

  return mapRowToSessionRecap(row, args.guildId, campaignSlug);
}
