import { getDbForCampaign } from "../db.js";
import { resolveCampaignSlug } from "../campaign/guildConfig.js";
import { getSessionById } from "./sessions.js";
import {
  generateSessionRecap as generateRecapForStyle,
  type RecapResult,
  type RecapStrategy,
} from "./recapEngine.js";

export type SessionRecapViews = {
  concise: string;
  balanced: string;
  detailed: string;
};

export type SessionRecap = {
  sessionId: string;
  guildId: string;
  campaignSlug: string;
  generatedAt: number;
  modelVersion: string;
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
  campaignSlug?: string;
  createdAtMs?: number;
  updatedAtMs?: number;
  engine?: string | null;
  sourceHash?: string | null;
  strategyVersion?: string | null;
  metaJson?: string | null;
  views: SessionRecapViews;
};

export const RECAP_DOMAIN_ERROR_CODES = [
  "RECAP_SESSION_NOT_FOUND",
  "RECAP_TRANSCRIPT_UNAVAILABLE",
  "RECAP_GENERATION_FAILED",
  "RECAP_INVALID_OUTPUT",
] as const;

export type RecapDomainErrorCode = (typeof RECAP_DOMAIN_ERROR_CODES)[number];

export class RecapDomainError extends Error {
  readonly code: RecapDomainErrorCode;

  constructor(code: RecapDomainErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "RecapDomainError";
    this.code = code;
  }
}

export function isRecapDomainError(error: unknown): error is RecapDomainError {
  return error instanceof RecapDomainError;
}

export type GenerateSessionRecapArgs = {
  guildId: string;
  sessionId: string;
  campaignSlug?: string;
  force?: boolean;
};

export type RegenerateSessionRecapArgs = {
  guildId: string;
  sessionId: string;
  campaignSlug?: string;
  reason?: string;
};

export type GenerateSessionRecapDeps = {
  generateStyleRecap?: (args: {
    guildId: string;
    sessionId: string;
    campaignSlug?: string;
    strategy: RecapStrategy;
    force?: boolean;
  }) => Promise<RecapResult>;
};

const SESSION_RECAP_MODEL_VERSION = "session-recaps-v2";
const RECAP_STYLES: readonly RecapStrategy[] = ["concise", "balanced", "detailed"];

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

function getLegacyRecapRow(db: ReturnType<typeof getRecapDbForGuild>["db"], sessionId: string): SessionRecapRow | null {
  // Legacy contract v1: recap_final artifacts stored a single balanced body.
  try {
    const artifact = db
      .prepare(
        `
        SELECT created_at_ms, engine, source_hash, strategy_version, meta_json, content_text
        FROM session_artifacts
        WHERE session_id = ?
          AND artifact_type = 'recap_final'
        ORDER BY created_at_ms DESC
        LIMIT 1
        `
      )
      .get(sessionId) as
      | {
          created_at_ms: number;
          engine: string | null;
          source_hash: string | null;
          strategy_version: string | null;
          meta_json: string | null;
          content_text: string | null;
        }
      | undefined;

    const content = artifact?.content_text?.trim();
    if (artifact && content) {
      return {
        session_id: sessionId,
        created_at_ms: artifact.created_at_ms,
        updated_at_ms: artifact.created_at_ms,
        engine: artifact.engine,
        source_hash: artifact.source_hash,
        strategy_version: artifact.strategy_version ?? "session-recaps-legacy-artifact-v1",
        meta_json: artifact.meta_json,
        concise_text: "",
        balanced_text: content,
        detailed_text: "",
      };
    }
  } catch {
    // Table/column can be absent in some DB generations.
  }

  // Older meecap contract: narrative body in meecaps table.
  try {
    const meecap = db
      .prepare(
        `
        SELECT created_at_ms, updated_at_ms, model, meecap_narrative, meecap_json
        FROM meecaps
        WHERE session_id = ?
        LIMIT 1
        `
      )
      .get(sessionId) as
      | {
          created_at_ms: number;
          updated_at_ms: number;
          model: string | null;
          meecap_narrative: string | null;
          meecap_json: string | null;
        }
      | undefined;

    const narrative = meecap?.meecap_narrative?.trim();
    if (meecap && narrative) {
      return {
        session_id: sessionId,
        created_at_ms: meecap.created_at_ms,
        updated_at_ms: meecap.updated_at_ms,
        engine: meecap.model,
        source_hash: null,
        strategy_version: "session-recaps-legacy-meecap-v1",
        meta_json: null,
        concise_text: "",
        balanced_text: narrative,
        detailed_text: "",
      };
    }
  } catch {
    // Table/column can be absent in some DB generations.
  }

  return null;
}

function getRecapDbForGuild(guildId: string, campaignSlugOverride?: string) {
  const campaignSlug = campaignSlugOverride?.trim() || resolveCampaignSlug({ guildId });
  return {
    campaignSlug,
    db: getDbForCampaign(campaignSlug),
  };
}

function mapRowToSessionRecap(row: SessionRecapRow, guildId: string, campaignSlug: string): SessionRecap {
  const modelVersion = row.strategy_version ?? SESSION_RECAP_MODEL_VERSION;
  return {
    sessionId: row.session_id,
    guildId,
    campaignSlug,
    generatedAt: row.updated_at_ms,
    modelVersion,
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

function toRecapDomainError(error: unknown): RecapDomainError {
  if (error instanceof RecapDomainError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  if (/Session not found/i.test(message)) {
    return new RecapDomainError("RECAP_SESSION_NOT_FOUND", message, { cause: error });
  }

  if (/transcript|No bronze transcript|No transcript/i.test(message)) {
    return new RecapDomainError("RECAP_TRANSCRIPT_UNAVAILABLE", message, { cause: error });
  }

  return new RecapDomainError("RECAP_GENERATION_FAILED", message, { cause: error });
}

function assertValidRecapOutput(style: RecapStrategy, result: RecapResult): void {
  if (!result || typeof result.text !== "string" || result.text.trim().length === 0) {
    throw new RecapDomainError(
      "RECAP_INVALID_OUTPUT",
      `Recap output for style '${style}' was empty or invalid.`
    );
  }
}

export function getSessionRecap(guildId: string, sessionId: string): SessionRecap | null {
  const { db, campaignSlug } = getRecapDbForGuild(guildId);
  const session = getSessionById(guildId, sessionId, campaignSlug);
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

  if (row) {
    return mapRowToSessionRecap(row, guildId, campaignSlug);
  }

  const legacyRow = getLegacyRecapRow(db, sessionId);
  return legacyRow ? mapRowToSessionRecap(legacyRow, guildId, campaignSlug) : null;
}

export async function generateSessionRecap(
  args: GenerateSessionRecapArgs,
  deps?: GenerateSessionRecapDeps
): Promise<SessionRecap> {
  const { db, campaignSlug } = getRecapDbForGuild(args.guildId, args.campaignSlug);
  const session = getSessionById(args.guildId, args.sessionId, campaignSlug);
  if (!session) {
    throw new RecapDomainError("RECAP_SESSION_NOT_FOUND", `Session not found: ${args.sessionId}`);
  }

  const generateStyleRecap = deps?.generateStyleRecap ?? generateRecapForStyle;
  const perStyle = new Map<RecapStrategy, RecapResult>();

  for (const style of RECAP_STYLES) {
    try {
      const result = await generateStyleRecap({
        guildId: args.guildId,
        sessionId: args.sessionId,
        campaignSlug,
        strategy: style,
        force: args.force ?? false,
      });
      assertValidRecapOutput(style, result);
      perStyle.set(style, result);
    } catch (error) {
      throw toRecapDomainError(error);
    }
  }

  const concise = perStyle.get("concise");
  const balanced = perStyle.get("balanced");
  const detailed = perStyle.get("detailed");
  if (!concise || !balanced || !detailed) {
    throw new RecapDomainError(
      "RECAP_INVALID_OUTPUT",
      `Recap generation did not produce all required styles for session ${args.sessionId}.`
    );
  }

  const generatedAt = Math.max(concise.createdAtMs, balanced.createdAtMs, detailed.createdAtMs);
  const now = Date.now();
  const existing = db
    .prepare("SELECT created_at_ms FROM session_recaps WHERE session_id = ? LIMIT 1")
    .get(args.sessionId) as { created_at_ms: number } | undefined;
  const createdAtMs = Number(existing?.created_at_ms ?? now);
  const modelVersion = balanced.strategyVersion || SESSION_RECAP_MODEL_VERSION;
  const metaJson = JSON.stringify({
    generated_at_ms: generatedAt,
    model_version: modelVersion,
    engine: balanced.engine,
    force: args.force ?? false,
    styles: {
      concise: {
        cacheHit: concise.cacheHit,
        sourceHash: concise.sourceTranscriptHash,
      },
      balanced: {
        cacheHit: balanced.cacheHit,
        sourceHash: balanced.sourceTranscriptHash,
      },
      detailed: {
        cacheHit: detailed.cacheHit,
        sourceHash: detailed.sourceTranscriptHash,
      },
    },
  });

  return upsertSessionRecap({
    guildId: args.guildId,
    sessionId: args.sessionId,
    campaignSlug,
    createdAtMs,
    updatedAtMs: generatedAt,
    engine: balanced.engine,
    sourceHash: balanced.sourceTranscriptHash,
    strategyVersion: modelVersion,
    metaJson,
    views: {
      concise: concise.text,
      balanced: balanced.text,
      detailed: detailed.text,
    },
  });
}

export async function regenerateSessionRecap(
  args: RegenerateSessionRecapArgs,
  deps?: GenerateSessionRecapDeps
): Promise<SessionRecap> {
  const recap = await generateSessionRecap(
    {
      guildId: args.guildId,
      sessionId: args.sessionId,
      campaignSlug: args.campaignSlug,
      force: true,
    },
    deps
  );

  const existingMeta = (() => {
    if (!recap.metaJson) return {} as Record<string, unknown>;
    try {
      const parsed = JSON.parse(recap.metaJson) as Record<string, unknown>;
      return typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch {
      return {} as Record<string, unknown>;
    }
  })();

  if (args.reason && args.reason.trim().length > 0) {
    return upsertSessionRecap({
      guildId: args.guildId,
      sessionId: args.sessionId,
      campaignSlug: args.campaignSlug,
      createdAtMs: recap.createdAtMs,
      updatedAtMs: recap.updatedAtMs,
      engine: recap.engine,
      sourceHash: recap.sourceHash,
      strategyVersion: recap.modelVersion,
      metaJson: JSON.stringify({
        ...existingMeta,
        regenerate_reason: args.reason.trim(),
      }),
      views: recap.views,
    });
  }

  return recap;
}

export function upsertSessionRecap(args: UpsertSessionRecapArgs): SessionRecap {
  const { db, campaignSlug } = getRecapDbForGuild(args.guildId, args.campaignSlug);
  const session = getSessionById(args.guildId, args.sessionId, campaignSlug);
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
