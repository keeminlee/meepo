import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type ArchiveSessionRow = {
  session_id: string;
  guild_id: string;
  status: "active" | "completed" | "interrupted";
  label: string | null;
  started_at_ms: number;
  source: string | null;
};

export type ArchiveTranscriptLine = {
  lineIndex: number;
  speaker: string;
  text: string;
  timestampMs: number;
};

export type ArchiveTranscript = {
  guildId: string;
  campaignSlug: string;
  sessionId: string;
  lineCount: number;
  lines: ArchiveTranscriptLine[];
};

export type ArchiveRecap = {
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
  views: {
    concise: string;
    balanced: string;
    detailed: string;
  };
};

const DEFAULT_CAMPAIGNS_DIR = "campaigns";
const DEFAULT_DB_FILENAME = "db.sqlite";
const DEFAULT_DATA_ROOT = "data";

const readDbCache = new Map<string, Database.Database | null>();

function resolveDataRoot(): string {
  const explicitRoot = process.env.DATA_ROOT?.trim();
  if (explicitRoot) {
    return path.resolve(explicitRoot);
  }

  const candidateRoots = [
    path.resolve(process.cwd(), "..", "..", DEFAULT_DATA_ROOT),
    path.resolve(process.cwd(), DEFAULT_DATA_ROOT),
  ];

  function scoreDataRoot(root: string): number {
    if (!fs.existsSync(root)) return -1;

    let score = 0;
    if (fs.existsSync(path.join(root, "campaigns"))) score += 4;
    if (fs.existsSync(path.join(root, "control", "control.sqlite"))) score += 4;
    if (fs.existsSync(path.join(root, "bot.sqlite"))) score += 2;
    return score;
  }

  let bestRoot = candidateRoots[0];
  let bestScore = scoreDataRoot(bestRoot);

  for (const root of candidateRoots.slice(1)) {
    const score = scoreDataRoot(root);
    if (score > bestScore) {
      bestRoot = root;
      bestScore = score;
    }
  }

  if (bestScore >= 0) {
    return bestRoot;
  }

  return candidateRoots[0];
}

function resolveCampaignsDir(): string {
  const campaignsDir = process.env.DATA_CAMPAIGNS_DIR?.trim();
  return campaignsDir && campaignsDir.length > 0 ? campaignsDir : DEFAULT_CAMPAIGNS_DIR;
}

function resolveDbFilenameCandidates(): string[] {
  const seen = new Set<string>();
  const raw = [
    process.env.DATA_DB_FILENAME?.trim(),
    DEFAULT_DB_FILENAME,
    "campaign.sqlite",
    "bot.sqlite",
  ];

  const out: string[] = [];
  for (const value of raw) {
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function getControlDbPath(): string {
  return path.join(resolveDataRoot(), "control", "control.sqlite");
}

export type GuildCampaignSlugDiagnostic = {
  guildId: string;
  dataRoot: string;
  controlDbPath: string;
  controlDbExists: boolean;
  foundGuildConfig: boolean;
  rawCampaignSlug: string | null;
  normalizedCampaignSlug: string | null;
  reason?: string;
};

function openReadOnlyDb(dbPath: string): Database.Database | null {
  if (readDbCache.has(dbPath)) {
    return readDbCache.get(dbPath) ?? null;
  }

  if (!fs.existsSync(dbPath)) {
    return null;
  }

  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    readDbCache.set(dbPath, db);
    return db;
  } catch {
    // Do not memoize failures: transient lock/open issues should be recoverable.
    return null;
  }
}

function resolveCampaignDbPath(campaignSlug: string): string | null {
  const campaignDir = path.join(resolveDataRoot(), resolveCampaignsDir(), campaignSlug);
  if (!fs.existsSync(campaignDir)) {
    return null;
  }

  for (const fileName of resolveDbFilenameCandidates()) {
    const candidate = path.join(campaignDir, fileName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getCampaignDb(campaignSlug: string): Database.Database | null {
  const dbPath = resolveCampaignDbPath(campaignSlug);
  if (!dbPath) return null;
  return openReadOnlyDb(dbPath);
}

export function getGuildCampaignSlug(guildId: string): string | null {
  return getGuildCampaignSlugDiagnostic(guildId).normalizedCampaignSlug;
}

export function getGuildCampaignSlugDiagnostic(guildId: string): GuildCampaignSlugDiagnostic {
  const normalizedGuildId = guildId.trim();
  const dataRoot = resolveDataRoot();
  const controlDbPath = path.join(dataRoot, "control", "control.sqlite");
  const controlDbExists = fs.existsSync(controlDbPath);

  if (!normalizedGuildId) {
    return {
      guildId,
      dataRoot,
      controlDbPath,
      controlDbExists,
      foundGuildConfig: false,
      rawCampaignSlug: null,
      normalizedCampaignSlug: null,
      reason: "empty guild id",
    };
  }

  const db = openReadOnlyDb(controlDbPath);
  if (!db) {
    return {
      guildId: normalizedGuildId,
      dataRoot,
      controlDbPath,
      controlDbExists,
      foundGuildConfig: false,
      rawCampaignSlug: null,
      normalizedCampaignSlug: null,
      reason: controlDbExists ? "control db open failed" : "control db missing",
    };
  }

  try {
    const row = db
      .prepare(
        "SELECT campaign_slug FROM guild_config WHERE guild_id = ? LIMIT 1"
      )
      .get(normalizedGuildId) as { campaign_slug?: string | null } | undefined;

    if (!row) {
      return {
        guildId: normalizedGuildId,
        dataRoot,
        controlDbPath,
        controlDbExists,
        foundGuildConfig: false,
        rawCampaignSlug: null,
        normalizedCampaignSlug: null,
        reason: "missing guild_config row",
      };
    }

    const rawCampaignSlug = typeof row.campaign_slug === "string" ? row.campaign_slug : null;
    const normalizedCampaignSlug = rawCampaignSlug?.trim() || null;

    if (!normalizedCampaignSlug) {
      return {
        guildId: normalizedGuildId,
        dataRoot,
        controlDbPath,
        controlDbExists,
        foundGuildConfig: true,
        rawCampaignSlug,
        normalizedCampaignSlug: null,
        reason: "empty campaign_slug",
      };
    }

    return {
      guildId: normalizedGuildId,
      dataRoot,
      controlDbPath,
      controlDbExists,
      foundGuildConfig: true,
      rawCampaignSlug,
      normalizedCampaignSlug,
    };
  } catch (error) {
    return {
      guildId: normalizedGuildId,
      dataRoot,
      controlDbPath,
      controlDbExists,
      foundGuildConfig: false,
      rawCampaignSlug: null,
      normalizedCampaignSlug: null,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function listSessionsForGuildCampaign(args: {
  guildId: string;
  campaignSlug: string;
  limit: number;
}): ArchiveSessionRow[] {
  const db = getCampaignDb(args.campaignSlug);
  if (!db) return [];

  const boundedLimit = Math.max(1, Math.min(100, Math.trunc(args.limit)));

  try {
    const rows = db
      .prepare(
        `SELECT session_id, guild_id, status, label, started_at_ms, source
         FROM sessions
         WHERE guild_id = ?
         ORDER BY started_at_ms DESC
         LIMIT ?`
      )
      .all(args.guildId, boundedLimit) as ArchiveSessionRow[];

    return rows;
  } catch {
    return [];
  }
}

export function findSessionByGuildAndId(args: {
  guildId: string;
  campaignSlug: string;
  sessionId: string;
}): ArchiveSessionRow | null {
  const db = getCampaignDb(args.campaignSlug);
  if (!db) return null;

  try {
    const row = db
      .prepare(
        `SELECT session_id, guild_id, status, label, started_at_ms, source
         FROM sessions
         WHERE guild_id = ? AND session_id = ?
         LIMIT 1`
      )
      .get(args.guildId, args.sessionId) as ArchiveSessionRow | undefined;

    return row ?? null;
  } catch {
    return null;
  }
}

export function readSessionTranscript(args: {
  guildId: string;
  campaignSlug: string;
  sessionId: string;
}): ArchiveTranscript | null {
  const db = getCampaignDb(args.campaignSlug);
  if (!db) {
    throw new Error("Transcript storage is unavailable for this campaign.");
  }

  try {
    const bronzeRows = db
      .prepare(
        `SELECT line_index, author_name, content, timestamp_ms
         FROM bronze_transcript
         WHERE session_id = ?
         ORDER BY line_index ASC`
      )
      .all(args.sessionId) as Array<{
      line_index: number;
      author_name: string;
      content: string;
      timestamp_ms: number;
    }>;

    if (bronzeRows.length > 0) {
      const lines = bronzeRows.map((row, idx) => ({
        lineIndex: idx,
        speaker: row.author_name,
        text: row.content,
        timestampMs: row.timestamp_ms,
      }));
      return {
        guildId: args.guildId,
        campaignSlug: args.campaignSlug,
        sessionId: args.sessionId,
        lineCount: lines.length,
        lines,
      };
    }
  } catch {
    // Fall through to ledger transcript fallback.
  }

  try {
    const ledgerRows = db
      .prepare(
        `SELECT author_name, COALESCE(content_norm, content) AS content_text, timestamp_ms
         FROM ledger_entries
         WHERE session_id = ?
           AND source IN ('text', 'voice', 'offline_ingest')
           AND narrative_weight = 'primary'
         ORDER BY timestamp_ms ASC, id ASC`
      )
      .all(args.sessionId) as Array<{
      author_name: string;
      content_text: string;
      timestamp_ms: number;
    }>;

    if (ledgerRows.length === 0) {
      return null;
    }

    const lines = ledgerRows.map((row, idx) => ({
      lineIndex: idx,
      speaker: row.author_name,
      text: row.content_text,
      timestampMs: row.timestamp_ms,
    }));

    return {
      guildId: args.guildId,
      campaignSlug: args.campaignSlug,
      sessionId: args.sessionId,
      lineCount: lines.length,
      lines,
    };
  } catch {
    throw new Error("Transcript retrieval failed for this session.");
  }
}

export function readSessionRecap(args: {
  guildId: string;
  campaignSlug: string;
  sessionId: string;
}): ArchiveRecap | null {
  const db = getCampaignDb(args.campaignSlug);
  if (!db) {
    throw new Error("Recap storage is unavailable for this campaign.");
  }

  try {
    const row = db
      .prepare(
        `SELECT session_id, created_at_ms, updated_at_ms, engine, source_hash, strategy_version, meta_json,
                concise_text, balanced_text, detailed_text
         FROM session_recaps
         WHERE session_id = ?
         LIMIT 1`
      )
      .get(args.sessionId) as
      | {
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
        }
      | undefined;

    if (!row) return null;

    const modelVersion = row.strategy_version ?? "session-recaps-v2";

    return {
      sessionId: row.session_id,
      guildId: args.guildId,
      campaignSlug: args.campaignSlug,
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
  } catch {
    // Fall through to legacy fallback paths.
  }

  try {
    const artifact = db
      .prepare(
        `SELECT created_at_ms, engine, source_hash, strategy_version, meta_json, content_text
         FROM session_artifacts
         WHERE session_id = ?
           AND artifact_type = 'recap_final'
         ORDER BY created_at_ms DESC
         LIMIT 1`
      )
      .get(args.sessionId) as
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
        sessionId: args.sessionId,
        guildId: args.guildId,
        campaignSlug: args.campaignSlug,
        generatedAt: artifact.created_at_ms,
        modelVersion: artifact.strategy_version ?? "session-recaps-legacy-artifact-v1",
        createdAtMs: artifact.created_at_ms,
        updatedAtMs: artifact.created_at_ms,
        engine: artifact.engine,
        sourceHash: artifact.source_hash,
        strategyVersion: artifact.strategy_version,
        metaJson: artifact.meta_json,
        views: {
          concise: content,
          balanced: content,
          detailed: content,
        },
      };
    }
  } catch {
    // Table/column can be absent in older DBs.
  }

  try {
    const meecap = db
      .prepare(
        `SELECT created_at_ms, updated_at_ms, model, meecap_narrative
         FROM meecaps
         WHERE session_id = ?
         LIMIT 1`
      )
      .get(args.sessionId) as
      | {
          created_at_ms: number;
          updated_at_ms: number;
          model: string | null;
          meecap_narrative: string | null;
        }
      | undefined;

    const narrative = meecap?.meecap_narrative?.trim();
    if (meecap && narrative) {
      return {
        sessionId: args.sessionId,
        guildId: args.guildId,
        campaignSlug: args.campaignSlug,
        generatedAt: meecap.updated_at_ms,
        modelVersion: "session-recaps-legacy-meecap-v1",
        createdAtMs: meecap.created_at_ms,
        updatedAtMs: meecap.updated_at_ms,
        engine: meecap.model,
        sourceHash: null,
        strategyVersion: "session-recaps-legacy-meecap-v1",
        metaJson: null,
        views: {
          concise: narrative,
          balanced: narrative,
          detailed: narrative,
        },
      };
    }
  } catch {
    // Table/column can be absent in older DBs.
  }

  return null;
}
