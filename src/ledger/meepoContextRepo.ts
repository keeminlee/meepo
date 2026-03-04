import { appendMeepoActionLogEvent, type MeepoActionRunKind } from "./meepoActionLogging.js";

export type ContextScope = "canon" | "ambient";

export const AMBIENT_SESSION_ID = "__ambient__";
export const RAW_LINES_KIND = "raw_lines";
export const MINI_MEECAP_KIND = "mini_meecap";
export const RECEIPT_KIND = "receipt";
export const COMPACT_MINI_ACTION = "compact-mini-meecap";
export const MEGAMEECAP_UPDATE_CHUNK_ACTION = "megameecap-update-chunk";
export const MEEPO_MIND_RETRIEVE_ACTION = "meepo-mind-retrieve";

export type MeepoContextRow = {
  guild_id: string;
  session_id: string;
  scope: ContextScope;
  revision_id: number;
  ledger_cursor_id: string | null;
  canon_line_cursor_total: number;
  canon_line_cursor_watermark: number;
  token_estimate: number;
  created_at_ms: number;
  updated_at_ms: number;
};

export type MeepoContextBlockRow = {
  id: string;
  guild_id: string;
  session_id: string;
  scope: ContextScope;
  kind: string;
  seq: number;
  content: string;
  token_estimate: number;
  source_range_json: string | null;
  superseded_at_ms: number | null;
};

export type ContextRawLine = {
  id: string;
  author_id: string;
  author_name: string;
  content: string;
  source: "text" | "voice" | "system";
  timestamp_ms: number;
};

export type ContextKey = {
  scope: ContextScope;
  sessionId: string;
};

export type SourceRange = {
  start_line: number;
  end_line: number;
  start_ledger_id?: string | null;
  end_ledger_id?: string | null;
  count?: number;
};

export type CompactMiniPayload = {
  guild_id: string;
  scope: ContextScope;
  session_id: string;
  start_line: number;
  end_line: number;
  start_ledger_id?: string;
  end_ledger_id?: string;
};

export type MegameecapUpdateChunkPayload = {
  guild_id: string;
  scope: ContextScope;
  session_id: string;
  range_start_ledger_id: string;
  range_end_ledger_id: string;
  chunk_index: number;
  algo_version: string;
};

export type MeepoMindRetrievePayload = {
  guild_id: string;
  campaign_slug: string;
  scope: ContextScope;
  session_id: string;
  anchor_ledger_id: string;
  query_text?: string;
  query_hash: string;
  top_k: number;
  algo_version: string;
  include_always_tier: true;
};

export type MeepoActionRow = {
  id: string;
  guild_id: string;
  scope: ContextScope;
  session_id: string;
  action_type: string;
  dedupe_key: string;
  payload_json: string;
  status: "pending" | "processing" | "done" | "failed";
  lease_owner: string | null;
  lease_until_ms: number | null;
  attempts: number;
  last_error: string | null;
  created_at_ms: number;
  updated_at_ms: number;
  completed_at_ms: number | null;
};

export type MeepoActionQueueStatus = {
  queuedCount: number;
  leasedCount: number;
  failedCount: number;
  oldestQueuedAgeMs: number | null;
  lastCompletedAtMs: number | null;
};

export function resolveContextKey(sessionId: string | null | undefined): ContextKey {
  const normalized = typeof sessionId === "string" ? sessionId.trim() : "";
  if (normalized.length > 0) {
    return {
      scope: "canon",
      sessionId: normalized,
    };
  }
  return {
    scope: "ambient",
    sessionId: AMBIENT_SESSION_ID,
  };
}

export function estimateTokenCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

export function serializeRawLines(lines: ContextRawLine[]): string {
  if (lines.length === 0) return "";
  return lines.map((line) => JSON.stringify(line)).join("\n");
}

export function parseRawLines(content: string): ContextRawLine[] {
  if (!content.trim()) return [];
  const rows: ContextRawLine[] = [];
  const chunks = content.split("\n");
  for (const chunk of chunks) {
    const line = chunk.trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as ContextRawLine;
      if (!parsed?.id || typeof parsed.timestamp_ms !== "number") continue;
      rows.push(parsed);
    } catch {
      continue;
    }
  }
  return rows;
}

export function withImmediateTransaction<T>(db: any, run: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = run();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getContextRow(db: any, args: { guildId: string; scope: ContextScope; sessionId: string }): MeepoContextRow | null {
  const row = db
    .prepare(
      `SELECT guild_id, session_id, scope, revision_id, ledger_cursor_id,
              canon_line_cursor_total, canon_line_cursor_watermark,
              token_estimate, created_at_ms, updated_at_ms
       FROM meepo_context
       WHERE guild_id = ? AND scope = ? AND session_id = ?
       LIMIT 1`
    )
    .get(args.guildId, args.scope, args.sessionId) as MeepoContextRow | undefined;
  return row ?? null;
}

export function ensureContextRow(db: any, args: {
  guildId: string;
  scope: ContextScope;
  sessionId: string;
  nowMs: number;
}): MeepoContextRow {
  const existing = getContextRow(db, args);
  if (existing) return existing;

  db.prepare(
    `INSERT INTO meepo_context (
      guild_id, session_id, scope, revision_id, ledger_cursor_id,
      canon_line_cursor_total, canon_line_cursor_watermark,
      token_estimate, created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, 0, NULL, 0, 0, 0, ?, ?)`
  ).run(args.guildId, args.sessionId, args.scope, args.nowMs, args.nowMs);

  return getContextRow(db, args)!;
}

export function getLastRawBlock(db: any, args: { guildId: string; scope: ContextScope; sessionId: string }): MeepoContextBlockRow | null {
  const row = db
    .prepare(
      `SELECT id, guild_id, session_id, scope, kind, seq, content, token_estimate, source_range_json, superseded_at_ms
       FROM meepo_context_blocks
       WHERE guild_id = ? AND scope = ? AND session_id = ?
         AND kind = ?
         AND superseded_at_ms IS NULL
       ORDER BY seq DESC
       LIMIT 1`
    )
    .get(args.guildId, args.scope, args.sessionId, RAW_LINES_KIND) as MeepoContextBlockRow | undefined;
  return row ?? null;
}

export function getRawBlocks(db: any, args: { guildId: string; scope: ContextScope; sessionId: string }): MeepoContextBlockRow[] {
  const rows = db
    .prepare(
      `SELECT id, guild_id, session_id, scope, kind, seq, content, token_estimate, source_range_json, superseded_at_ms
       FROM meepo_context_blocks
       WHERE guild_id = ? AND scope = ? AND session_id = ?
         AND kind = ?
         AND superseded_at_ms IS NULL
       ORDER BY seq ASC`
    )
    .all(args.guildId, args.scope, args.sessionId, RAW_LINES_KIND) as MeepoContextBlockRow[];
  return rows;
}

export function getBlocksByKind(db: any, args: {
  guildId: string;
  scope: ContextScope;
  sessionId: string;
  kind: string;
}): MeepoContextBlockRow[] {
  return db
    .prepare(
      `SELECT id, guild_id, session_id, scope, kind, seq, content, token_estimate, source_range_json, superseded_at_ms
       FROM meepo_context_blocks
       WHERE guild_id = ? AND scope = ? AND session_id = ? AND kind = ? AND superseded_at_ms IS NULL
       ORDER BY seq ASC`
    )
    .all(args.guildId, args.scope, args.sessionId, args.kind) as MeepoContextBlockRow[];
}

export function getLatestBlockByKind(db: any, args: {
  guildId: string;
  scope: ContextScope;
  sessionId: string;
  kind: string;
}): MeepoContextBlockRow | null {
  const row = db
    .prepare(
      `SELECT id, guild_id, session_id, scope, kind, seq, content, token_estimate, source_range_json, superseded_at_ms
       FROM meepo_context_blocks
       WHERE guild_id = ? AND scope = ? AND session_id = ? AND kind = ? AND superseded_at_ms IS NULL
       ORDER BY seq DESC
       LIMIT 1`
    )
    .get(args.guildId, args.scope, args.sessionId, args.kind) as MeepoContextBlockRow | undefined;
  return row ?? null;
}

export function nextSeqForKind(db: any, args: {
  guildId: string;
  scope: ContextScope;
  sessionId: string;
  kind: string;
}): number {
  const row = db
    .prepare(
      `SELECT COALESCE(MAX(seq), 0) AS max_seq
       FROM meepo_context_blocks
       WHERE guild_id = ? AND scope = ? AND session_id = ? AND kind = ?`
    )
    .get(args.guildId, args.scope, args.sessionId, args.kind) as { max_seq: number } | undefined;
  return Number(row?.max_seq ?? 0) + 1;
}

export function parseSourceRange(rangeJson: string | null): SourceRange | null {
  if (!rangeJson) return null;
  try {
    const parsed = JSON.parse(rangeJson) as SourceRange;
    if (typeof parsed?.start_line !== "number" || typeof parsed?.end_line !== "number") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function enqueueActionIfMissing(db: any, args: {
  id: string;
  guildId: string;
  scope: ContextScope;
  sessionId: string;
  actionType: string;
  dedupeKey: string;
  payloadJson: string;
  nowMs: number;
  runKind?: MeepoActionRunKind;
  anchorLedgerId?: string | null;
  reason?: string;
}): { queued: boolean; existingActionId?: string } {
  const existing = db
    .prepare(`SELECT id FROM meepo_actions WHERE dedupe_key = ? LIMIT 1`)
    .get(args.dedupeKey) as { id: string } | undefined;
  if (existing) {
    appendMeepoActionLogEvent(db, {
      ts_ms: args.nowMs,
      run_kind: args.runKind ?? "online",
      guild_id: args.guildId,
      scope: args.scope,
      session_id: args.sessionId,
      anchor_ledger_id: args.anchorLedgerId ?? null,
      event: "action-deduped",
      data: {
        action_type: args.actionType,
        dedupe_key: args.dedupeKey,
        existing_action_id: existing.id,
        reason: args.reason,
        status: "skipped",
      },
    });
    return { queued: false, existingActionId: existing.id };
  }

  db.prepare(
    `INSERT INTO meepo_actions (
      id, guild_id, scope, session_id, action_type, dedupe_key, payload_json,
      status, lease_owner, lease_until_ms, attempts, last_error, created_at_ms, updated_at_ms, completed_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, 0, NULL, ?, ?, NULL)`
  ).run(
    args.id,
    args.guildId,
    args.scope,
    args.sessionId,
    args.actionType,
    args.dedupeKey,
    args.payloadJson,
    args.nowMs,
    args.nowMs
  );
  appendMeepoActionLogEvent(db, {
    ts_ms: args.nowMs,
    run_kind: args.runKind ?? "online",
    guild_id: args.guildId,
    scope: args.scope,
    session_id: args.sessionId,
    anchor_ledger_id: args.anchorLedgerId ?? null,
    event: "action-enqueued",
    data: {
      action_type: args.actionType,
      dedupe_key: args.dedupeKey,
      reason: args.reason,
      status: "pending",
    },
  });
  return { queued: true };
}

export function claimNextAction(db: any, args: {
  leaseOwner: string;
  leaseMs: number;
  nowMs: number;
}): MeepoActionRow | null {
  const candidate = db
    .prepare(
      `SELECT id, guild_id, scope, session_id, action_type, dedupe_key, payload_json, status,
              lease_owner, lease_until_ms, attempts, last_error, created_at_ms, updated_at_ms, completed_at_ms
       FROM meepo_actions
       WHERE (status = 'pending' AND (lease_until_ms IS NULL OR lease_until_ms <= ?))
          OR (status = 'processing' AND lease_until_ms IS NOT NULL AND lease_until_ms <= ?)
       ORDER BY created_at_ms ASC
       LIMIT 1`
    )
     .get(args.nowMs, args.nowMs) as MeepoActionRow | undefined;
  if (!candidate) return null;

  const leaseUntilMs = args.nowMs + Math.max(1, args.leaseMs);
  const update = db
    .prepare(
      `UPDATE meepo_actions
       SET status = 'processing',
           lease_owner = ?,
           lease_until_ms = ?,
           attempts = attempts + 1,
           updated_at_ms = ?
       WHERE id = ?
         AND (
           (status = 'pending' AND (lease_until_ms IS NULL OR lease_until_ms <= ?))
           OR (status = 'processing' AND lease_until_ms IS NOT NULL AND lease_until_ms <= ?)
         )`
    )
    .run(args.leaseOwner, leaseUntilMs, args.nowMs, candidate.id, args.nowMs, args.nowMs) as { changes: number };

  if (!update || update.changes !== 1) {
    return null;
  }

  return db
    .prepare(
      `SELECT id, guild_id, scope, session_id, action_type, dedupe_key, payload_json, status,
              lease_owner, lease_until_ms, attempts, last_error, created_at_ms, updated_at_ms, completed_at_ms
       FROM meepo_actions
       WHERE id = ?
       LIMIT 1`
    )
    .get(candidate.id) as MeepoActionRow;
}

export function markActionDone(db: any, args: { actionId: string; nowMs: number }): void {
  db.prepare(
    `UPDATE meepo_actions
     SET status = 'done',
         lease_owner = NULL,
         lease_until_ms = NULL,
         last_error = NULL,
         completed_at_ms = ?,
         updated_at_ms = ?
     WHERE id = ?`
  ).run(args.nowMs, args.nowMs, args.actionId);
}

export function markActionFailed(db: any, args: { actionId: string; nowMs: number; error: string }): void {
  db.prepare(
    `UPDATE meepo_actions
     SET status = 'failed',
         lease_owner = NULL,
         lease_until_ms = NULL,
         last_error = ?,
         updated_at_ms = ?
     WHERE id = ?`
  ).run(args.error, args.nowMs, args.actionId);
}

export function releaseActionForRetry(db: any, args: {
  actionId: string;
  nowMs: number;
  nextAttemptAtMs: number;
  error: string;
}): void {
  db.prepare(
    `UPDATE meepo_actions
     SET status = 'pending',
         lease_owner = NULL,
         lease_until_ms = ?,
         last_error = ?,
         updated_at_ms = ?
     WHERE id = ?`
  ).run(args.nextAttemptAtMs, args.error, args.nowMs, args.actionId);
}

export function getMeepoActionQueueStatus(db: any, nowMs: number): MeepoActionQueueStatus {
  const queuedRow = db.prepare(
    `SELECT COUNT(*) AS n, MIN(created_at_ms) AS oldest
     FROM meepo_actions
     WHERE status = 'pending' AND (lease_until_ms IS NULL OR lease_until_ms <= ?)`
  ).get(nowMs) as { n: number; oldest: number | null } | undefined;

  const leasedRow = db.prepare(
    `SELECT COUNT(*) AS n
     FROM meepo_actions
     WHERE status = 'processing' AND lease_until_ms IS NOT NULL AND lease_until_ms > ?`
  ).get(nowMs) as { n: number } | undefined;

  const failedRow = db.prepare(
    `SELECT COUNT(*) AS n
     FROM meepo_actions
     WHERE status = 'failed'`
  ).get() as { n: number } | undefined;

  const completedRow = db.prepare(
    `SELECT MAX(completed_at_ms) AS ts
     FROM meepo_actions
     WHERE status = 'done'`
  ).get() as { ts: number | null } | undefined;

  const oldestQueuedAgeMs = queuedRow?.oldest ? Math.max(0, nowMs - queuedRow.oldest) : null;
  return {
    queuedCount: Number(queuedRow?.n ?? 0),
    leasedCount: Number(leasedRow?.n ?? 0),
    failedCount: Number(failedRow?.n ?? 0),
    oldestQueuedAgeMs,
    lastCompletedAtMs: completedRow?.ts ?? null,
  };
}

export function sumContextTokens(db: any, args: { guildId: string; scope: ContextScope; sessionId: string }): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(token_estimate), 0) AS total
       FROM meepo_context_blocks
       WHERE guild_id = ? AND scope = ? AND session_id = ? AND superseded_at_ms IS NULL`
    )
    .get(args.guildId, args.scope, args.sessionId) as { total: number } | undefined;
  return Number(row?.total ?? 0);
}

export function getCursorAnchor(db: any, cursorId: string): { id: string; timestamp_ms: number } | null {
  const row = db
    .prepare(`SELECT id, timestamp_ms FROM ledger_entries WHERE id = ? LIMIT 1`)
    .get(cursorId) as { id: string; timestamp_ms: number } | undefined;
  return row ?? null;
}

export function getLedgerLinesAfterCursor(db: any, args: {
  guildId: string;
  scope: ContextScope;
  sessionId: string;
  cursorId: string | null;
}): ContextRawLine[] {
  const scopeClause =
    args.scope === "canon"
      ? "session_id = @sessionId"
      : "session_id IS NULL";

  if (!args.cursorId) {
    return db
      .prepare(
        `SELECT id, author_id, author_name, content, source, timestamp_ms
         FROM ledger_entries
         WHERE guild_id = @guildId
           AND ${scopeClause}
         ORDER BY timestamp_ms ASC, id ASC`
      )
      .all({ guildId: args.guildId, sessionId: args.sessionId }) as ContextRawLine[];
  }

  const anchor = getCursorAnchor(db, args.cursorId);
  if (!anchor) {
    return db
      .prepare(
        `SELECT id, author_id, author_name, content, source, timestamp_ms
         FROM ledger_entries
         WHERE guild_id = @guildId
           AND ${scopeClause}
         ORDER BY timestamp_ms ASC, id ASC`
      )
      .all({ guildId: args.guildId, sessionId: args.sessionId }) as ContextRawLine[];
  }

  return db
    .prepare(
      `SELECT id, author_id, author_name, content, source, timestamp_ms
       FROM ledger_entries
       WHERE guild_id = @guildId
         AND ${scopeClause}
         AND (
           timestamp_ms > @anchorTs
           OR (timestamp_ms = @anchorTs AND id > @anchorId)
         )
       ORDER BY timestamp_ms ASC, id ASC`
    )
    .all({
      guildId: args.guildId,
      sessionId: args.sessionId,
      anchorTs: anchor.timestamp_ms,
      anchorId: anchor.id,
    }) as ContextRawLine[];
}
