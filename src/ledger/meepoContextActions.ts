import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { orchestrateMegaMeecap, runFinalPassOnly } from "../tools/megameecap/orchestrate.js";
import {
  COMPACT_MINI_ACTION,
  MEEPO_MIND_RETRIEVE_ACTION,
  MEGAMEECAP_UPDATE_CHUNK_ACTION,
  MINI_MEECAP_KIND,
  type MeepoMindRetrievePayload,
  RAW_LINES_KIND,
  RECEIPT_KIND,
  claimNextAction,
  enqueueActionIfMissing,
  ensureContextRow,
  estimateTokenCount,
  getBlocksByKind,
  getMeepoActionQueueStatus,
  markActionDone,
  markActionFailed,
  nextSeqForKind,
  parseRawLines,
  parseSourceRange,
  releaseActionForRetry,
  sumContextTokens,
  withImmediateTransaction,
  type CompactMiniPayload,
  type ContextRawLine,
  type ContextScope,
  type MegameecapUpdateChunkPayload,
  type MeepoActionRow,
} from "./meepoContextRepo.js";
import {
  appendMeepoActionLogEvent,
  flushDirtyMeepoActionMergedLogs,
  type MeepoActionRunKind,
} from "./meepoActionLogging.js";
import { log } from "../utils/logger.js";

export const CANON_MINI_TRIGGER_LINES = 250;
export const MEGAMEECAP_ALGO_VERSION = "megameecap-chunk-v1";
const DEFAULT_MEGAMEECAP_MODEL = process.env.MEGAMEECAP_MODEL?.trim() || "gpt-4o-mini";
const DEFAULT_MEGAMEECAP_CALL_MAX_TOKENS = 6_000;

export type MeepoContextActionExecutionOptions = {
  leaseTtlMs: number;
  maxAttempts: number;
  retryBaseMs: number;
  runKind?: MeepoActionRunKind;
};

export type MeepoContextActionTickOptions = MeepoContextActionExecutionOptions & {
  maxActionsPerTick: number;
  maxTotalRuntimeMs: number;
};

export type MeepoContextActionTickResult = {
  processed: number;
  succeeded: number;
  failed: number;
  timedOut: boolean;
  elapsedMs: number;
};

const DEFAULT_EXEC_OPTIONS: MeepoContextActionExecutionOptions = {
  leaseTtlMs: 30_000,
  maxAttempts: 4,
  retryBaseMs: 500,
};

export function buildCompactionDedupeKey(args: {
  guildId: string;
  scope: ContextScope;
  sessionId: string;
  startLine: number;
  endLine: number;
}): string {
  return `${COMPACT_MINI_ACTION}:${args.guildId}:${args.scope}:${args.sessionId}:${args.startLine}-${args.endLine}`;
}

export function buildMegameecapChunkDedupeKey(args: {
  guildId: string;
  scope: ContextScope;
  sessionId: string;
  rangeStartLedgerId: string;
  rangeEndLedgerId: string;
  algoVersion: string;
}): string {
  return [
    MEGAMEECAP_UPDATE_CHUNK_ACTION,
    args.guildId,
    args.scope,
    args.sessionId,
    args.rangeStartLedgerId,
    args.rangeEndLedgerId,
    args.algoVersion,
  ].join(":");
}

export function buildMeepoMindRetrieveDedupeKey(args: {
  guildId: string;
  scope: ContextScope;
  sessionId: string;
  anchorLedgerId: string;
  algoVersion: string;
  topK: number;
  queryHash: string;
}): string {
  return [
    MEEPO_MIND_RETRIEVE_ACTION,
    args.guildId,
    args.scope,
    args.sessionId,
    args.anchorLedgerId,
    args.algoVersion,
    String(args.topK),
    args.queryHash,
  ].join(":");
}

function selectNextMegameecapRange(args: {
  cursorTotal: number;
  cursorWatermark: number;
}): { startLine: number; endLine: number; chunkIndex: number } | null {
  const delta = args.cursorTotal - args.cursorWatermark;
  if (delta < CANON_MINI_TRIGGER_LINES) return null;
  const startLine = args.cursorWatermark + 1;
  const endLine = Math.min(args.cursorTotal, args.cursorWatermark + CANON_MINI_TRIGGER_LINES);
  const chunkIndex = Math.floor((startLine - 1) / CANON_MINI_TRIGGER_LINES) + 1;
  return { startLine, endLine, chunkIndex };
}

function getCanonRawLines(db: any, args: { guildId: string; sessionId: string }): ContextRawLine[] {
  const rawBlocks = getBlocksByKind(db, {
    guildId: args.guildId,
    scope: "canon",
    sessionId: args.sessionId,
    kind: RAW_LINES_KIND,
  });
  return rawBlocks.flatMap((block) => parseRawLines(block.content));
}

export function enqueueMiniCompactionIfNeeded(db: any, args: {
  guildId: string;
  scope: ContextScope;
  sessionId: string;
  cursorTotal: number;
  cursorWatermark: number;
  nowMs: number;
  runKind?: MeepoActionRunKind;
}): { attempted: boolean; queued: boolean } {
  if (args.scope !== "canon") return { attempted: false, queued: false };
  if (args.cursorTotal - args.cursorWatermark < CANON_MINI_TRIGGER_LINES) return { attempted: false, queued: false };

  const startLine = args.cursorWatermark + 1;
  const endLine = args.cursorTotal;
  const dedupeKey = buildCompactionDedupeKey({
    guildId: args.guildId,
    scope: args.scope,
    sessionId: args.sessionId,
    startLine,
    endLine,
  });

  const payload: CompactMiniPayload = {
    guild_id: args.guildId,
    scope: args.scope,
    session_id: args.sessionId,
    start_line: startLine,
    end_line: endLine,
  };

  const allRawLines = getCanonRawLines(db, {
    guildId: args.guildId,
    sessionId: args.sessionId,
  });
  const startRawLine = allRawLines[startLine - 1];
  const endRawLine = allRawLines[endLine - 1];
  if (startRawLine?.id) payload.start_ledger_id = startRawLine.id;
  if (endRawLine?.id) payload.end_ledger_id = endRawLine.id;

  const enqueueResult = enqueueActionIfMissing(db, {
    id: randomUUID(),
    guildId: args.guildId,
    scope: args.scope,
    sessionId: args.sessionId,
    actionType: COMPACT_MINI_ACTION,
    dedupeKey,
    payloadJson: JSON.stringify(payload),
    nowMs: args.nowMs,
    runKind: args.runKind,
    anchorLedgerId: endRawLine?.id ?? null,
    reason: "threshold",
  });

  return { attempted: true, queued: enqueueResult.queued };
}

export function enqueueMegameecapChunkIfNeeded(db: any, args: {
  guildId: string;
  scope: ContextScope;
  sessionId: string;
  cursorTotal: number;
  cursorWatermark: number;
  nowMs: number;
  runKind?: MeepoActionRunKind;
}): { attempted: boolean; queued: boolean } {
  if (args.scope !== "canon") return { attempted: false, queued: false };
  const nextRange = selectNextMegameecapRange({
    cursorTotal: args.cursorTotal,
    cursorWatermark: args.cursorWatermark,
  });
  if (!nextRange) return { attempted: false, queued: false };

  const allRawLines = getCanonRawLines(db, {
    guildId: args.guildId,
    sessionId: args.sessionId,
  });
  if (allRawLines.length < nextRange.endLine) return { attempted: false, queued: false };

  const startLine = allRawLines[nextRange.startLine - 1];
  const endLine = allRawLines[nextRange.endLine - 1];
  if (!startLine?.id || !endLine?.id) return { attempted: false, queued: false };

  const payload: MegameecapUpdateChunkPayload = {
    guild_id: args.guildId,
    scope: args.scope,
    session_id: args.sessionId,
    range_start_ledger_id: startLine.id,
    range_end_ledger_id: endLine.id,
    chunk_index: nextRange.chunkIndex,
    algo_version: MEGAMEECAP_ALGO_VERSION,
  };

  const dedupeKey = buildMegameecapChunkDedupeKey({
    guildId: payload.guild_id,
    scope: payload.scope,
    sessionId: payload.session_id,
    rangeStartLedgerId: payload.range_start_ledger_id,
    rangeEndLedgerId: payload.range_end_ledger_id,
    algoVersion: payload.algo_version,
  });

  const enqueueResult = enqueueActionIfMissing(db, {
    id: randomUUID(),
    guildId: payload.guild_id,
    scope: payload.scope,
    sessionId: payload.session_id,
    actionType: MEGAMEECAP_UPDATE_CHUNK_ACTION,
    dedupeKey,
    payloadJson: JSON.stringify(payload),
    nowMs: args.nowMs,
    runKind: args.runKind,
    anchorLedgerId: payload.range_end_ledger_id,
    reason: "threshold",
  });

  return { attempted: true, queued: enqueueResult.queued };
}

export function enqueueMeepoMindRetrieveIfNeeded(db: any, args: {
  guildId: string;
  campaignSlug: string;
  scope: ContextScope;
  sessionId: string;
  anchorLedgerId: string;
  queryText?: string;
  queryHash: string;
  topK: number;
  algoVersion: string;
  nowMs: number;
  runKind?: MeepoActionRunKind;
}): boolean {
  const payload: MeepoMindRetrievePayload = {
    guild_id: args.guildId,
    campaign_slug: args.campaignSlug,
    scope: args.scope,
    session_id: args.sessionId,
    anchor_ledger_id: args.anchorLedgerId,
    query_text: args.queryText,
    query_hash: args.queryHash,
    top_k: args.topK,
    algo_version: args.algoVersion,
    include_always_tier: true,
  };

  const dedupeKey = buildMeepoMindRetrieveDedupeKey({
    guildId: args.guildId,
    scope: args.scope,
    sessionId: args.sessionId,
    anchorLedgerId: args.anchorLedgerId,
    algoVersion: args.algoVersion,
    topK: args.topK,
    queryHash: args.queryHash,
  });

  const enqueueResult = enqueueActionIfMissing(db, {
    id: randomUUID(),
    guildId: args.guildId,
    scope: args.scope,
    sessionId: args.sessionId,
    actionType: MEEPO_MIND_RETRIEVE_ACTION,
    dedupeKey,
    payloadJson: JSON.stringify(payload),
    nowMs: args.nowMs,
    runKind: args.runKind,
    anchorLedgerId: args.anchorLedgerId,
    reason: "missing_artifact",
  });

  appendMeepoActionLogEvent(db, {
    ts_ms: args.nowMs,
    run_kind: args.runKind ?? "online",
    guild_id: args.guildId,
    scope: args.scope,
    session_id: args.sessionId,
    event_type: enqueueResult.queued ? "RETRIEVAL_ENQUEUED" : "action-deduped",
    anchor_ledger_id: args.anchorLedgerId,
    action_type: MEEPO_MIND_RETRIEVE_ACTION,
    dedupe_key: dedupeKey,
    data: {
      existing_action_id: enqueueResult.existingActionId,
      reason: "missing_artifact",
    },
    algo_version: args.algoVersion,
    query_hash: args.queryHash,
    top_k: args.topK,
    status: enqueueResult.queued ? "pending" : "skipped",
  });

  return enqueueResult.queued;
}

function parseCompactPayload(action: MeepoActionRow): CompactMiniPayload {
  const payload = JSON.parse(action.payload_json) as CompactMiniPayload;
  if (
    !payload
    || typeof payload.guild_id !== "string"
    || typeof payload.scope !== "string"
    || typeof payload.session_id !== "string"
    || typeof payload.start_line !== "number"
    || typeof payload.end_line !== "number"
  ) {
    throw new Error("Invalid compaction payload");
  }
  return payload;
}

function parseMegameecapPayload(action: MeepoActionRow): MegameecapUpdateChunkPayload {
  const payload = JSON.parse(action.payload_json) as MegameecapUpdateChunkPayload;
  if (
    !payload
    || typeof payload.guild_id !== "string"
    || typeof payload.scope !== "string"
    || typeof payload.session_id !== "string"
    || typeof payload.range_start_ledger_id !== "string"
    || typeof payload.range_end_ledger_id !== "string"
    || typeof payload.chunk_index !== "number"
    || payload.chunk_index < 1
    || typeof payload.algo_version !== "string"
    || payload.algo_version.trim().length === 0
  ) {
    throw new Error("Invalid megameecap chunk payload");
  }
  return payload;
}

function parseMeepoMindRetrievePayload(action: MeepoActionRow): MeepoMindRetrievePayload {
  const payload = JSON.parse(action.payload_json) as MeepoMindRetrievePayload;
  if (
    !payload
    || typeof payload.guild_id !== "string"
    || typeof payload.campaign_slug !== "string"
    || typeof payload.scope !== "string"
    || typeof payload.session_id !== "string"
    || typeof payload.anchor_ledger_id !== "string"
    || typeof payload.query_hash !== "string"
    || typeof payload.top_k !== "number"
    || payload.top_k < 0
    || typeof payload.algo_version !== "string"
    || payload.algo_version.trim().length === 0
    || payload.include_always_tier !== true
  ) {
    throw new Error("Invalid meepo mind retrieval payload");
  }
  return payload;
}

function parseReceiptContent(content: string): Record<string, unknown> | null {
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function renderMiniSummary(lines: Array<{ author_name: string; content: string }>, startLine: number, endLine: number): string {
  const header = `Mini meecap lines ${startLine}-${endLine}`;
  const body = lines
    .slice(-24)
    .map((line) => `${line.author_name}: ${line.content}`)
    .join("\n");
  return body ? `${header}\n${body}` : header;
}

function findRawRangeByLedgerIds(lines: ContextRawLine[], startLedgerId: string, endLedgerId: string): {
  startLine: number;
  endLine: number;
  selected: ContextRawLine[];
} {
  const startIndex = lines.findIndex((line) => line.id === startLedgerId);
  const endIndex = lines.findIndex((line) => line.id === endLedgerId);
  if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) {
    throw new Error("Invalid megameecap range ids");
  }
  const selected = lines.slice(startIndex, endIndex + 1);
  if (selected.length === 0) {
    throw new Error("Megameecap range resolved to empty selection");
  }
  return {
    startLine: startIndex + 1,
    endLine: endIndex + 1,
    selected,
  };
}

function readSessionLabel(db: any, guildId: string, sessionId: string): string | null {
  const row = db
    .prepare(`SELECT label FROM sessions WHERE guild_id = ? AND session_id = ? LIMIT 1`)
    .get(guildId, sessionId) as { label: string | null } | undefined;
  return row?.label ?? null;
}

function resolveCampaignSlugForGuild(db: any, guildId: string): string {
  try {
    const row = db
      .prepare(`SELECT campaign_slug FROM guild_config WHERE guild_id = ? LIMIT 1`)
      .get(guildId) as { campaign_slug: string } | undefined;
    const value = row?.campaign_slug?.trim();
    return value && value.length > 0 ? value : "default";
  } catch {
    return "default";
  }
}

function writeFileAtomic(filePath: string, content: string): void {
  const absPath = path.resolve(filePath);
  const dir = path.dirname(absPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(
    dir,
    `.${path.basename(absPath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  );
  fs.writeFileSync(tmpPath, content, "utf8");
  fs.renameSync(tmpPath, absPath);
}

function performCompactMiniAction(db: any, action: MeepoActionRow, nowMs: number): void {
  const payload = parseCompactPayload(action);
  const context = ensureContextRow(db, {
    guildId: payload.guild_id,
    scope: payload.scope,
    sessionId: payload.session_id,
    nowMs,
  });

  const receiptBlocks = getBlocksByKind(db, {
    guildId: payload.guild_id,
    scope: payload.scope,
    sessionId: payload.session_id,
    kind: RECEIPT_KIND,
  });

  for (const receipt of receiptBlocks) {
    const parsed = parseReceiptContent(receipt.content);
    if (
      parsed
      && parsed.start_line === payload.start_line
      && parsed.end_line === payload.end_line
      && parsed.action_type === COMPACT_MINI_ACTION
    ) {
      const nextWatermark = Math.max(context.canon_line_cursor_watermark, payload.end_line);
      db.prepare(
        `UPDATE meepo_context
         SET canon_line_cursor_watermark = ?, updated_at_ms = ?
         WHERE guild_id = ? AND scope = ? AND session_id = ?`
      ).run(nextWatermark, nowMs, payload.guild_id, payload.scope, payload.session_id);
      return;
    }
  }

  const rawBlocks = getBlocksByKind(db, {
    guildId: payload.guild_id,
    scope: payload.scope,
    sessionId: payload.session_id,
    kind: RAW_LINES_KIND,
  });
  const allRawLines = rawBlocks.flatMap((block) => parseRawLines(block.content));
  const selected = allRawLines.slice(payload.start_line - 1, payload.end_line);

  const miniContent = renderMiniSummary(selected, payload.start_line, payload.end_line);
  const miniSourceRange = {
    start_line: payload.start_line,
    end_line: payload.end_line,
    start_ledger_id: selected[0]?.id ?? null,
    end_ledger_id: selected[selected.length - 1]?.id ?? null,
    count: selected.length,
  };

  db.prepare(
    `INSERT INTO meepo_context_blocks (
      id, guild_id, session_id, scope, kind, seq, content, token_estimate, source_range_json, superseded_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
  ).run(
    randomUUID(),
    payload.guild_id,
    payload.session_id,
    payload.scope,
    MINI_MEECAP_KIND,
    nextSeqForKind(db, {
      guildId: payload.guild_id,
      scope: payload.scope,
      sessionId: payload.session_id,
      kind: MINI_MEECAP_KIND,
    }),
    miniContent,
    estimateTokenCount(miniContent),
    JSON.stringify(miniSourceRange)
  );

  const receiptContent = JSON.stringify({
    action_type: COMPACT_MINI_ACTION,
    dedupe_key: action.dedupe_key,
    start_line: payload.start_line,
    end_line: payload.end_line,
    start_ledger_id: selected[0]?.id ?? null,
    end_ledger_id: selected[selected.length - 1]?.id ?? null,
    line_count: selected.length,
    created_at_ms: nowMs,
  });

  db.prepare(
    `INSERT INTO meepo_context_blocks (
      id, guild_id, session_id, scope, kind, seq, content, token_estimate, source_range_json, superseded_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
  ).run(
    randomUUID(),
    payload.guild_id,
    payload.session_id,
    payload.scope,
    RECEIPT_KIND,
    nextSeqForKind(db, {
      guildId: payload.guild_id,
      scope: payload.scope,
      sessionId: payload.session_id,
      kind: RECEIPT_KIND,
    }),
    receiptContent,
    estimateTokenCount(receiptContent),
    JSON.stringify({
      start_line: payload.start_line,
      end_line: payload.end_line,
      start_ledger_id: selected[0]?.id ?? null,
      end_ledger_id: selected[selected.length - 1]?.id ?? null,
      count: selected.length,
    })
  );

  const tokenEstimate = sumContextTokens(db, {
    guildId: payload.guild_id,
    scope: payload.scope,
    sessionId: payload.session_id,
  });
  const nextWatermark = Math.max(context.canon_line_cursor_watermark, payload.end_line);

  db.prepare(
    `UPDATE meepo_context
     SET canon_line_cursor_watermark = ?,
         token_estimate = ?,
         revision_id = revision_id + 1,
         updated_at_ms = ?
     WHERE guild_id = ? AND scope = ? AND session_id = ?`
  ).run(
    nextWatermark,
    tokenEstimate,
    nowMs,
    payload.guild_id,
    payload.scope,
    payload.session_id
  );
}

type MegameecapCommit = {
  guildId: string;
  scope: ContextScope;
  sessionId: string;
  startLine: number;
  endLine: number;
  startLedgerId: string;
  endLedgerId: string;
  chunkIndex: number;
  algoVersion: string;
  tokenEstimate: number;
  replayOnly: boolean;
  llmDispatchLogCount: number;
  attempt: number;
};

function resolveActionAnchorLedgerId(db: any, action: MeepoActionRow): string | null {
  try {
    if (action.action_type === MEEPO_MIND_RETRIEVE_ACTION) {
      const payload = parseMeepoMindRetrievePayload(action);
      return payload.anchor_ledger_id;
    }
    if (action.action_type === MEGAMEECAP_UPDATE_CHUNK_ACTION) {
      const payload = parseMegameecapPayload(action);
      return payload.range_end_ledger_id;
    }
    if (action.action_type === COMPACT_MINI_ACTION) {
      const payload = parseCompactPayload(action);
      if (payload.end_ledger_id?.trim()) return payload.end_ledger_id;
      const allRawLines = getCanonRawLines(db, {
        guildId: payload.guild_id,
        sessionId: payload.session_id,
      });
      return allRawLines[payload.end_line - 1]?.id ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

async function prepareMegameecapChunkCommit(
  db: any,
  action: MeepoActionRow,
  runKind: MeepoActionRunKind,
): Promise<MegameecapCommit> {
  const payload = parseMegameecapPayload(action);
  const nowMs = Date.now();
  const context = ensureContextRow(db, {
    guildId: payload.guild_id,
    scope: payload.scope,
    sessionId: payload.session_id,
    nowMs,
  });

  const receipts = getBlocksByKind(db, {
    guildId: payload.guild_id,
    scope: payload.scope,
    sessionId: payload.session_id,
    kind: RECEIPT_KIND,
  });

  for (const receipt of receipts) {
    const parsed = parseReceiptContent(receipt.content);
    if (
      parsed?.action_type === MEGAMEECAP_UPDATE_CHUNK_ACTION
      && parsed.dedupe_key === action.dedupe_key
      && typeof parsed.end_line === "number"
      && typeof parsed.start_line === "number"
      && typeof parsed.start_ledger_id === "string"
      && typeof parsed.end_ledger_id === "string"
    ) {
      return {
        guildId: payload.guild_id,
        scope: payload.scope,
        sessionId: payload.session_id,
        startLine: parsed.start_line,
        endLine: parsed.end_line,
        startLedgerId: parsed.start_ledger_id,
        endLedgerId: parsed.end_ledger_id,
        chunkIndex: payload.chunk_index,
        algoVersion: payload.algo_version,
        tokenEstimate: sumContextTokens(db, {
          guildId: payload.guild_id,
          scope: payload.scope,
          sessionId: payload.session_id,
        }),
        replayOnly: true,
        llmDispatchLogCount: 0,
        attempt: action.attempts,
      };
    }
  }

  const allRawLines = getCanonRawLines(db, {
    guildId: payload.guild_id,
    sessionId: payload.session_id,
  });
  const range = findRawRangeByLedgerIds(
    allRawLines,
    payload.range_start_ledger_id,
    payload.range_end_ledger_id
  );

  const campaignSlug = resolveCampaignSlugForGuild(db, payload.guild_id);
  const sessionLabel = readSessionLabel(db, payload.guild_id, payload.session_id);
  const { buildSessionArtifactStem, resolveSessionMegameecapPaths } = await import("../dataPaths.js");
  const paths = resolveSessionMegameecapPaths({
    campaignSlug,
    sessionId: payload.session_id,
    sessionLabel,
    finalStyle: "balanced",
    chunk: {
      chunkIndex: payload.chunk_index,
      rangeStartLedgerId: payload.range_start_ledger_id,
      rangeEndLedgerId: payload.range_end_ledger_id,
      algoVersion: payload.algo_version,
    },
  });

  const chunkLines = range.selected.map((line, index) => ({
    lineIndex: range.startLine + index,
    speaker: line.author_name,
    text: line.content,
  }));

  const attemptState: {
    dispatchLogged: boolean;
    dispatchLogCount: number;
  } = {
    dispatchLogged: false,
    dispatchLogCount: 0,
  };

  const callLlm = async (input: { systemPrompt: string; userPrompt: string; model: string; maxTokens?: number }) => {
    const allowDispatchLoggingInTests = process.env.MEEPO_TEST_ENABLE_LLM_DISPATCH_LOG === "1";
    if (!attemptState.dispatchLogged) {
      appendMeepoActionLogEvent(db, {
        ts_ms: Date.now(),
        run_kind: runKind,
        guild_id: payload.guild_id,
        scope: payload.scope,
        session_id: payload.session_id,
        event_type: "llm_prompt_dispatch",
        anchor_ledger_id: payload.range_end_ledger_id,
        action_id: action.id,
        action_type: action.action_type,
        dedupe_key: action.dedupe_key,
        attempt: action.attempts,
        range_start_ledger_id: payload.range_start_ledger_id,
        range_end_ledger_id: payload.range_end_ledger_id,
        chunk_index: payload.chunk_index,
        algo_version: payload.algo_version,
        prompt: {
          system: input.systemPrompt,
          user: input.userPrompt,
          model: input.model,
          max_tokens: input.maxTokens,
        },
      });
      attemptState.dispatchLogged = true;
      attemptState.dispatchLogCount += 1;
    }

    if (process.env.NODE_ENV === "test" && !allowDispatchLoggingInTests) {
      return "mock llm output";
    }

    const { chat } = await import("../llm/client.js");
    return chat({
      systemPrompt: input.systemPrompt,
      userMessage: input.userPrompt,
      model: input.model,
      maxTokens: input.maxTokens ?? DEFAULT_MEGAMEECAP_CALL_MAX_TOKENS,
    });
  };

  const chunkOutput = await orchestrateMegaMeecap(
    {
      sessionLabel: sessionLabel ?? payload.session_id,
      campaign: campaignSlug,
      segmentSize: 120,
      maxLlmLines: 120,
      carryConfig: {
        maxCarryChars: 8000,
        maxCarrySegments: 3,
      },
      style: "balanced",
      noFinalPass: true,
      model: DEFAULT_MEGAMEECAP_MODEL,
      lines: chunkLines,
    },
    { callLlm }
  );

  if (!paths.chunkPath || !paths.chunkMetaPath) {
    throw new Error("Missing chunk artifact paths");
  }

  writeFileAtomic(paths.chunkPath, chunkOutput.baselineMarkdown);
  writeFileAtomic(
    paths.chunkMetaPath,
    JSON.stringify(
      {
        action_type: MEGAMEECAP_UPDATE_CHUNK_ACTION,
        dedupe_key: action.dedupe_key,
        session_id: payload.session_id,
        chunk_index: payload.chunk_index,
        algo_version: payload.algo_version,
        range_start_ledger_id: payload.range_start_ledger_id,
        range_end_ledger_id: payload.range_end_ledger_id,
        start_line: range.startLine,
        end_line: range.endLine,
        line_count: range.selected.length,
        generated_at_ms: Date.now(),
        model: DEFAULT_MEGAMEECAP_MODEL,
      },
      null,
      2
    )
  );

  const chunkPrefix = `${buildSessionArtifactStem(payload.session_id, sessionLabel)}-megameecap-chunk-`;
  const chunkBodies = fs
    .readdirSync(paths.outputDir)
    .filter((name) => name.startsWith(chunkPrefix) && name.endsWith(".md"))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => fs.readFileSync(path.join(paths.outputDir, name), "utf8").trim())
    .filter((body) => body.length > 0);

  const baseMarkdown = chunkBodies.length > 0
    ? `${chunkBodies.join("\n\n---\n\n")}\n`
    : `${chunkOutput.baselineMarkdown.trim()}\n`;

  writeFileAtomic(paths.basePath, baseMarkdown);
  writeFileAtomic(
    paths.baseMetaPath,
    JSON.stringify(
      {
        engine: "megameecap",
        mode: "worker-file-backed",
        source: "meepo_actions",
        action_type: MEGAMEECAP_UPDATE_CHUNK_ACTION,
        session_id: payload.session_id,
        source_range: {
          start_line: range.startLine,
          end_line: range.endLine,
          start_ledger_id: payload.range_start_ledger_id,
          end_ledger_id: payload.range_end_ledger_id,
          count: range.selected.length,
        },
        chunk_index: payload.chunk_index,
        algo_version: payload.algo_version,
        model: DEFAULT_MEGAMEECAP_MODEL,
        generated_at_ms: Date.now(),
      },
      null,
      2
    )
  );

  const final = await runFinalPassOnly({
    baselineMarkdown: baseMarkdown,
    style: "balanced",
    model: DEFAULT_MEGAMEECAP_MODEL,
    callLlm,
  });

  writeFileAtomic(paths.finalPath, final.finalMarkdown);
  writeFileAtomic(
    paths.finalMetaPath,
    JSON.stringify(
      {
        engine: "megameecap",
        mode: "worker-file-backed",
        source: "meepo_actions",
        action_type: MEGAMEECAP_UPDATE_CHUNK_ACTION,
        style: "balanced",
        session_id: payload.session_id,
        source_range: {
          start_line: range.startLine,
          end_line: range.endLine,
          start_ledger_id: payload.range_start_ledger_id,
          end_ledger_id: payload.range_end_ledger_id,
          count: range.selected.length,
        },
        chunk_index: payload.chunk_index,
        algo_version: payload.algo_version,
        model: DEFAULT_MEGAMEECAP_MODEL,
        final_pass_ms: final.finalPassMs,
        generated_at_ms: Date.now(),
      },
      null,
      2
    )
  );

  return {
    guildId: payload.guild_id,
    scope: payload.scope,
    sessionId: payload.session_id,
    startLine: range.startLine,
    endLine: range.endLine,
    startLedgerId: payload.range_start_ledger_id,
    endLedgerId: payload.range_end_ledger_id,
    chunkIndex: payload.chunk_index,
    algoVersion: payload.algo_version,
    tokenEstimate: sumContextTokens(db, {
      guildId: payload.guild_id,
      scope: payload.scope,
      sessionId: payload.session_id,
    }),
    replayOnly: false,
    llmDispatchLogCount: attemptState.dispatchLogCount,
    attempt: action.attempts,
  };
}

function commitMegameecapChunk(db: any, action: MeepoActionRow, commit: MegameecapCommit, nowMs: number): void {
  const context = ensureContextRow(db, {
    guildId: commit.guildId,
    scope: commit.scope,
    sessionId: commit.sessionId,
    nowMs,
  });

  if (!commit.replayOnly) {
    const receiptContent = JSON.stringify({
      action_type: MEGAMEECAP_UPDATE_CHUNK_ACTION,
      dedupe_key: action.dedupe_key,
      session_id: commit.sessionId,
      start_line: commit.startLine,
      end_line: commit.endLine,
      start_ledger_id: commit.startLedgerId,
      end_ledger_id: commit.endLedgerId,
      chunk_index: commit.chunkIndex,
      algo_version: commit.algoVersion,
      created_at_ms: nowMs,
    });

    db.prepare(
      `INSERT INTO meepo_context_blocks (
        id, guild_id, session_id, scope, kind, seq, content, token_estimate, source_range_json, superseded_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    ).run(
      randomUUID(),
      commit.guildId,
      commit.sessionId,
      commit.scope,
      RECEIPT_KIND,
      nextSeqForKind(db, {
        guildId: commit.guildId,
        scope: commit.scope,
        sessionId: commit.sessionId,
        kind: RECEIPT_KIND,
      }),
      receiptContent,
      estimateTokenCount(receiptContent),
      JSON.stringify({
        start_line: commit.startLine,
        end_line: commit.endLine,
        start_ledger_id: commit.startLedgerId,
        end_ledger_id: commit.endLedgerId,
        count: commit.endLine - commit.startLine + 1,
      })
    );
  }

  const nextWatermark = Math.max(context.canon_line_cursor_watermark, commit.endLine);
  db.prepare(
    `UPDATE meepo_context
     SET canon_line_cursor_watermark = ?,
         token_estimate = ?,
         revision_id = revision_id + 1,
         updated_at_ms = ?
     WHERE guild_id = ? AND scope = ? AND session_id = ?`
  ).run(
    nextWatermark,
    commit.tokenEstimate,
    nowMs,
    commit.guildId,
    commit.scope,
    commit.sessionId
  );
}

export async function processOneMeepoContextAction(
  db: any,
  leaseOwner = "heartbeat",
  options: MeepoContextActionExecutionOptions = DEFAULT_EXEC_OPTIONS
): Promise<boolean> {
  const nowMs = Date.now();
  const runKind = options.runKind ?? "online";
  const action = withImmediateTransaction(db, () =>
    claimNextAction(db, {
      leaseOwner,
      leaseMs: options.leaseTtlMs,
      nowMs,
    })
  );
  if (!action) return false;

  const anchorLedgerId = resolveActionAnchorLedgerId(db, action);
  if (anchorLedgerId) {
    appendMeepoActionLogEvent(db, {
      ts_ms: nowMs,
      run_kind: runKind,
      guild_id: action.guild_id,
      scope: action.scope,
      session_id: action.session_id,
      event_type: "action_claimed",
      anchor_ledger_id: anchorLedgerId,
      action_id: action.id,
      action_type: action.action_type,
      dedupe_key: action.dedupe_key,
      attempt: action.attempts,
      status: action.status,
    });
  }

  try {
    if (action.action_type === MEEPO_MIND_RETRIEVE_ACTION) {
      const payload = parseMeepoMindRetrievePayload(action);
      const { executeMeepoMindRetrieveAction } = await import("./meepoMindRetrieveAction.js");
      const result = executeMeepoMindRetrieveAction(payload);
      withImmediateTransaction(db, () => {
        markActionDone(db, { actionId: action.id, nowMs: Date.now() });
      });
      appendMeepoActionLogEvent(db, {
        ts_ms: Date.now(),
        run_kind: runKind,
        guild_id: action.guild_id,
        scope: action.scope,
        session_id: action.session_id,
        event_type: "RETRIEVAL_DONE",
        anchor_ledger_id: payload.anchor_ledger_id,
        action_id: action.id,
        action_type: action.action_type,
        dedupe_key: action.dedupe_key,
        algo_version: payload.algo_version,
        query_hash: payload.query_hash,
        top_k: payload.top_k,
        artifact_path: result.artifactPath,
        always_count: result.alwaysCount,
        ranked_count: result.rankedCount,
        db_ms: result.dbMs,
        attempt: action.attempts,
        status: "done",
      });
      return true;
    }

    if (action.action_type === COMPACT_MINI_ACTION) {
      withImmediateTransaction(db, () => {
        performCompactMiniAction(db, action, Date.now());
        markActionDone(db, { actionId: action.id, nowMs: Date.now() });
      });
      if (anchorLedgerId) {
        appendMeepoActionLogEvent(db, {
          ts_ms: Date.now(),
          run_kind: runKind,
          guild_id: action.guild_id,
          scope: action.scope,
          session_id: action.session_id,
          event_type: "action_done",
          anchor_ledger_id: anchorLedgerId,
          action_id: action.id,
          action_type: action.action_type,
          dedupe_key: action.dedupe_key,
          attempt: action.attempts,
          status: "done",
        });
      }
      return true;
    }

    if (action.action_type === MEGAMEECAP_UPDATE_CHUNK_ACTION) {
      const commit = await prepareMegameecapChunkCommit(db, action, runKind);
      withImmediateTransaction(db, () => {
        commitMegameecapChunk(db, action, commit, Date.now());
        markActionDone(db, { actionId: action.id, nowMs: Date.now() });
      });
      if (commit.llmDispatchLogCount > 1) {
        log.warn("Duplicate LLM dispatch detected for action", "ledger", {
          sessionId: action.session_id,
          rangeStartLedgerId: commit.startLedgerId,
          rangeEndLedgerId: commit.endLedgerId,
          chunkIndex: commit.chunkIndex,
          attempt: commit.attempt,
          dispatchCount: commit.llmDispatchLogCount,
          actionId: action.id,
        });
      }
      appendMeepoActionLogEvent(db, {
        ts_ms: Date.now(),
        run_kind: runKind,
        guild_id: action.guild_id,
        scope: action.scope,
        session_id: action.session_id,
        event_type: "action_done",
        anchor_ledger_id: commit.endLedgerId,
        action_id: action.id,
        action_type: action.action_type,
        dedupe_key: action.dedupe_key,
        attempt: action.attempts,
        status: "done",
        range_start_ledger_id: commit.startLedgerId,
        range_end_ledger_id: commit.endLedgerId,
        chunk_index: commit.chunkIndex,
        algo_version: commit.algoVersion,
      });
      return true;
    }

    throw new Error(`Unknown action_type: ${action.action_type}`);
  } catch (error: any) {
    const now = Date.now();
    const message = String(error?.message ?? error ?? "unknown_error");
    const terminalFailure = action.attempts >= options.maxAttempts;
    withImmediateTransaction(db, () => {
      if (terminalFailure) {
        markActionFailed(db, {
          actionId: action.id,
          nowMs: now,
          error: message,
        });
        return;
      }
      const backoffMs = options.retryBaseMs * Math.pow(2, Math.max(0, action.attempts - 1));
      releaseActionForRetry(db, {
        actionId: action.id,
        nowMs: now,
        nextAttemptAtMs: now + backoffMs,
        error: message,
      });
    });

    if (anchorLedgerId) {
      appendMeepoActionLogEvent(db, {
        ts_ms: now,
        run_kind: runKind,
        guild_id: action.guild_id,
        scope: action.scope,
        session_id: action.session_id,
        event_type: terminalFailure ? "action_failed_terminal" : "action_failed_retry",
        anchor_ledger_id: anchorLedgerId,
        action_id: action.id,
        action_type: action.action_type,
        dedupe_key: action.dedupe_key,
        attempt: action.attempts,
        status: terminalFailure ? "failed" : "pending",
        error: message,
      });
    }
    return false;
  }
}

export async function processMeepoContextActionsTick(
  db: any,
  leaseOwner: string,
  options: MeepoContextActionTickOptions
): Promise<MeepoContextActionTickResult> {
  const startMs = Date.now();
  const runKind = options.runKind ?? "online";
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let timedOut = false;

  while (processed < options.maxActionsPerTick) {
    if (Date.now() - startMs >= options.maxTotalRuntimeMs) {
      timedOut = true;
      break;
    }
    const before = getMeepoActionQueueStatus(db, Date.now());
    const ok = await processOneMeepoContextAction(db, leaseOwner, {
      leaseTtlMs: options.leaseTtlMs,
      maxAttempts: options.maxAttempts,
      retryBaseMs: options.retryBaseMs,
      runKind,
    });
    if (!ok) {
      const after = getMeepoActionQueueStatus(db, Date.now());
      if (before.queuedCount === after.queuedCount && before.leasedCount === after.leasedCount) {
        break;
      }
      processed += 1;
      failed += 1;
      continue;
    }
    processed += 1;
    succeeded += 1;
  }

  flushDirtyMeepoActionMergedLogs(db, { runKind });

  return {
    processed,
    succeeded,
    failed,
    timedOut,
    elapsedMs: Date.now() - startMs,
  };
}

export function getMeepoContextQueueStatus(db: any): {
  queuedCount: number;
  leasedCount: number;
  failedCount: number;
  oldestQueuedAgeMs: number | null;
  lastCompletedAtMs: number | null;
} {
  return getMeepoActionQueueStatus(db, Date.now());
}

export function resolveReceiptWatermark(db: any, args: {
  guildId: string;
  scope: ContextScope;
  sessionId: string;
}): number {
  const receipts = getBlocksByKind(db, {
    guildId: args.guildId,
    scope: args.scope,
    sessionId: args.sessionId,
    kind: RECEIPT_KIND,
  });
  let maxEnd = 0;
  for (const receipt of receipts) {
    const parsedRange = parseSourceRange(receipt.source_range_json);
    if (parsedRange?.end_line && parsedRange.end_line > maxEnd) {
      maxEnd = parsedRange.end_line;
      continue;
    }
    const parsedContent = parseReceiptContent(receipt.content);
    if (typeof parsedContent?.end_line === "number" && parsedContent.end_line > maxEnd) {
      maxEnd = parsedContent.end_line;
    }
  }
  return maxEnd;
}
