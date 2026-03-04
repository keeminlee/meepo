import fs from "node:fs";
import path from "node:path";
import type { ContextScope } from "./meepoContextRepo.js";

export type MeepoActionRunKind = "online" | "offline_replay";

type TranscriptLine = {
  ledger_id: string;
  author_name: string;
  content: string;
  line_id?: string | number;
};

export type MeepoActionLogEvent = {
  ts_ms: number;
  event?: string;
  run_kind: MeepoActionRunKind;
  guild_id: string;
  scope: ContextScope;
  campaign_slug?: string;
  session_id: string;
  event_type?: string;
  anchor_ledger_id?: string | null;
  data?: Record<string, unknown>;
  action_id?: string;
  action_type?: string;
  status?: string;
  dedupe_key?: string;
  attempt?: number;
  range_start_ledger_id?: string;
  range_end_ledger_id?: string;
  chunk_index?: number;
  algo_version?: string;
  query_hash?: string;
  top_k?: number;
  artifact_path?: string;
  always_count?: number;
  ranked_count?: number;
  db_ms?: number;
  error?: string;
  transcript_line?: TranscriptLine;
  prompt?: {
    system?: string;
    user?: string;
    model?: string;
    max_tokens?: number;
  };
};

const dirtyKeys = new Set<string>();
let announcedConsoleMirror = false;

type ParsedTranscriptLine = {
  anchorLedgerId: string;
  authorName: string;
  content: string;
  lineId?: string;
  ordinal: number;
};

type ParsedNonTranscriptEvent = {
  event: MeepoActionLogEvent;
  ordinal: number;
};

function opt(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function boolFromEnv(name: string, def: boolean): boolean {
  const value = opt(name);
  if (!value) return def;
  const normalized = value.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return def;
}

function getLogScopes(): string[] {
  return (process.env.LOG_SCOPES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function hasMeepoActionsScopeEnabled(): boolean {
  return getLogScopes().includes("meepo_actions");
}

function isDebugLogLevel(): boolean {
  return (opt("LOG_LEVEL") ?? "").toLowerCase() === "debug";
}

function shouldMirrorToConsole(): boolean {
  return hasMeepoActionsScopeEnabled() && isDebugLogLevel();
}

function maybeAnnounceConsoleMirror(): void {
  if (announcedConsoleMirror) return;
  if (!shouldMirrorToConsole()) return;
  announcedConsoleMirror = true;
  console.info("[INFO] Meepo telemetry scopes: meepo_actions");
  console.info("[INFO] Console debug mirroring: enabled");
}

function includeTranscriptLinesInMergedLog(): boolean {
  return boolFromEnv("MEEPO_ACTION_LOGGING_INCLUDE_TRANSCRIPT_LINES", true);
}

function buildSessionArtifactStem(sessionId: string, sessionLabel?: string | null): string {
  const safeLabel = (sessionLabel ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `session-${safeLabel.length > 0 ? safeLabel : sessionId}`;
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
  try {
    fs.renameSync(tmpPath, absPath);
  } catch (error: any) {
    const code = String(error?.code ?? "");
    if (code === "EPERM" || code === "EACCES") {
      fs.writeFileSync(absPath, content, "utf8");
      fs.rmSync(tmpPath, { force: true });
      return;
    }
    fs.rmSync(tmpPath, { force: true });
    throw error;
  }
}

function shouldWriteEvent(args: {
  eventName: string;
  runKind: MeepoActionRunKind;
  scope: ContextScope;
  sessionId: string;
}): boolean {
  const defaultEnabled = process.env.NODE_ENV === "test" ? false : true;
  const enabled = boolFromEnv("MEEPO_ACTION_LOGGING_ENABLED", defaultEnabled);
  if (!enabled) return false;
  const forceActionLogs = boolFromEnv("MEEPO_FORCE_ACTION_LOGS", false);
  if (!forceActionLogs) {
    const hasMeepoActionsScope = hasMeepoActionsScopeEnabled();
    if (!hasMeepoActionsScope) {
      return false;
    }
  }
  if (args.eventName === "replay_start" || args.eventName === "replay_end") return false;
  if (args.runKind === "online") {
    return args.scope === "canon" && args.sessionId !== "__ambient__";
  }
  return args.scope === "canon";
}

function toDisplayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "null";
  return String(value);
}

function summarizeEventForConsole(event: MeepoActionLogEvent): string {
  const eventName = event.event ?? event.event_type ?? "unknown";
  const anchor = toDisplayValue(event.anchor_ledger_id);
  const actionType = readEventDataValue<string>(event, "action_type");
  const status = readEventDataValue<string>(event, "status");

  if (eventName === "heartbeat-tick") {
    const cursorBefore = readEventDataValue<string | null>(event, "cursor_before");
    const cursorAfter = readEventDataValue<string | null>(event, "cursor_after");
    const watermarkBefore = readEventDataValue<number>(event, "watermark_before");
    const watermarkAfter = readEventDataValue<number>(event, "watermark_after");
    const canonDelta = readEventDataValue<number>(event, "canon_delta");
    const enqueued = readEventDataValue<number>(event, "enqueued_count");
    const deduped = readEventDataValue<number>(event, "deduped_count");
    return `${eventName} anchor=${anchor} cursor=${toDisplayValue(cursorBefore)}→${toDisplayValue(cursorAfter)} watermark=${toDisplayValue(watermarkBefore)}→${toDisplayValue(watermarkAfter)} canon_delta=${toDisplayValue(canonDelta)} enq=${toDisplayValue(enqueued)} dedupe=${toDisplayValue(deduped)}`;
  }

  if (eventName === "context-snapshot-built") {
    const messageCount = readEventDataValue<number>(event, "message_count");
    const contextHash = readEventDataValue<string>(event, "context_hash");
    return `${eventName} anchor=${anchor} msgs=${toDisplayValue(messageCount)} hash=${contextHash ? contextHash.slice(0, 8) : "null"}`;
  }

  if (eventName === "prompt-bundle-built") {
    const hasRetrieval = readEventDataValue<boolean>(event, "has_retrieval");
    const estimatedTokens = readEventDataValue<number>(event, "estimated_tokens");
    return `${eventName} anchor=${anchor} has_retrieval=${toDisplayValue(hasRetrieval)} tokens≈${toDisplayValue(estimatedTokens)}`;
  }

  if (eventName === "RETRIEVAL_DONE" || eventName === "retrieval-done") {
    const alwaysCount = readEventDataValue<number>(event, "always_count");
    const rankedCount = readEventDataValue<number>(event, "ranked_count");
    return `${eventName} anchor=${anchor} always=${toDisplayValue(alwaysCount)} ranked=${toDisplayValue(rankedCount)}`;
  }

  if (eventName === "action-enqueued" || eventName === "action-deduped") {
    const dedupeKey = readEventDataValue<string>(event, "dedupe_key");
    return `${eventName} anchor=${anchor} type=${toDisplayValue(actionType)} status=${toDisplayValue(status)} dedupe=${dedupeKey ? dedupeKey.slice(0, 24) : "null"}`;
  }

  return `${eventName} anchor=${anchor} type=${toDisplayValue(actionType)} status=${toDisplayValue(status)}`;
}

function resolveEventName(event: MeepoActionLogEvent): string {
  const explicit = event.event?.trim();
  if (explicit) return explicit;
  const legacy = event.event_type?.trim();
  return legacy ?? "";
}

function readEventDataValue<T = unknown>(event: MeepoActionLogEvent, key: string): T | undefined {
  const data = event.data;
  if (data && Object.prototype.hasOwnProperty.call(data, key)) {
    return data[key] as T;
  }
  return (event as Record<string, unknown>)[key] as T | undefined;
}

function normalizeMeepoActionLogEvent(db: any, event: MeepoActionLogEvent): MeepoActionLogEvent {
  const eventName = resolveEventName(event);
  const normalizedData: Record<string, unknown> = {
    ...(event.data ?? {}),
  };
  const fieldNames = [
    "action_id",
    "action_type",
    "status",
    "dedupe_key",
    "attempt",
    "range_start_ledger_id",
    "range_end_ledger_id",
    "chunk_index",
    "algo_version",
    "query_hash",
    "top_k",
    "artifact_path",
    "always_count",
    "ranked_count",
    "db_ms",
    "error",
    "prompt",
    "transcript_line",
  ] as const;

  for (const fieldName of fieldNames) {
    const currentValue = (event as Record<string, unknown>)[fieldName];
    if (currentValue === undefined) continue;
    if (!(fieldName in normalizedData)) {
      normalizedData[fieldName] = currentValue;
    }
  }

  return {
    ts_ms: event.ts_ms,
    event: eventName,
    event_type: eventName,
    run_kind: event.run_kind,
    guild_id: event.guild_id,
    scope: event.scope,
    campaign_slug: event.campaign_slug ?? resolveCampaignSlugForGuild(db, event.guild_id),
    session_id: event.session_id,
    anchor_ledger_id: event.anchor_ledger_id ?? null,
    data: normalizedData,
    transcript_line: event.transcript_line,
    prompt: event.prompt,
  };
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

function readSessionLabel(db: any, guildId: string, sessionId: string): string | null {
  try {
    const row = db
      .prepare(`SELECT label FROM sessions WHERE guild_id = ? AND session_id = ? LIMIT 1`)
      .get(guildId, sessionId) as { label: string | null } | undefined;
    return row?.label ?? null;
  } catch {
    return null;
  }
}

function resolveMeecapOutputDir(campaignSlug: string): string {
  const replayArtifactOverride = opt("MEEPO_HEARTBEAT_REPLAY_ARTIFACT_DIR");
  if (replayArtifactOverride) {
    const outputDir = path.resolve(replayArtifactOverride);
    fs.mkdirSync(outputDir, { recursive: true });
    return outputDir;
  }

  const dataRoot = path.resolve(opt("DATA_ROOT") ?? "./data");
  const campaignsDir = opt("DATA_CAMPAIGNS_DIR") ?? "campaigns";
  const outputDir = path.join(dataRoot, campaignsDir, campaignSlug, "exports", "meecaps");
  fs.mkdirSync(outputDir, { recursive: true });
  return outputDir;
}

export function resolveMeepoActionLogPaths(db: any, args: {
  guildId: string;
  sessionId: string;
  runKind: MeepoActionRunKind;
}): { jsonlPath: string; mergedLogPath: string } {
  const campaignSlug = resolveCampaignSlugForGuild(db, args.guildId);
  const sessionLabel = readSessionLabel(db, args.guildId, args.sessionId);
  const stem = buildSessionArtifactStem(args.sessionId, sessionLabel);
  const suffix = args.runKind === "offline_replay" ? "offline-replay" : "online";
  const outputDir = resolveMeecapOutputDir(campaignSlug);
  return {
    jsonlPath: path.join(outputDir, `${stem}-meepo-actions-${suffix}.jsonl`),
    mergedLogPath: path.join(outputDir, `${stem}-meepo-actions-${suffix}.log`),
  };
}

function buildDirtyKey(args: {
  runKind: MeepoActionRunKind;
  guildId: string;
  scope: ContextScope;
  sessionId: string;
}): string {
  return [args.runKind, args.guildId, args.scope, args.sessionId].join("|");
}

function parseDirtyKey(key: string): {
  runKind: MeepoActionRunKind;
  guildId: string;
  scope: ContextScope;
  sessionId: string;
} {
  const [runKind, guildId, scope, sessionId] = key.split("|");
  return {
    runKind: runKind === "offline_replay" ? "offline_replay" : "online",
    guildId,
    scope: scope === "ambient" ? "ambient" : "canon",
    sessionId,
  };
}

function buildLedgerIndexMap(db: any, args: {
  guildId: string;
  scope: ContextScope;
  sessionId: string;
}): Map<string, number> {
  const sessionFilter = args.scope === "canon"
    ? "session_id = ?"
    : "session_id IS NULL";

  const rows = db
    .prepare(
      `SELECT id
       FROM ledger_entries
       WHERE guild_id = ?
         AND ${sessionFilter}
       ORDER BY timestamp_ms ASC, id ASC`
    )
    .all(
      ...(args.scope === "canon"
        ? [args.guildId, args.sessionId]
        : [args.guildId])
    ) as Array<{ id: string }>;

  const out = new Map<string, number>();
  for (let index = 0; index < rows.length; index += 1) {
    out.set(rows[index]!.id, index + 1);
  }
  return out;
}

function renderLineRef(ledgerId: string, ledgerIndexMap: Map<string, number>): string {
  void ledgerIndexMap;
  return `L${ledgerId}`;
}

function renderTranscriptLine(
  line: ParsedTranscriptLine,
  ledgerIndexMap: Map<string, number>,
  displayIndex: number
): string {
  const anchor = `[${renderLineRef(line.anchorLedgerId, ledgerIndexMap)}]`;
  const text = line.authorName ? `${line.authorName}: ${line.content}` : line.content;
  return `[#${displayIndex}] ${anchor} ${text}`;
}

function renderEventLine(event: MeepoActionLogEvent, ledgerIndexMap: Map<string, number>): string {
  const anchorLedgerId = event.anchor_ledger_id?.trim() || "session";
  const anchor = `[${renderLineRef(anchorLedgerId, ledgerIndexMap)}]`;
  const attrs: string[] = [];
  attrs.push(`event=${event.event ?? event.event_type ?? "unknown"}`);
  const actionType = readEventDataValue<string>(event, "action_type");
  const status = readEventDataValue<string>(event, "status");
  const attempt = readEventDataValue<number>(event, "attempt");
  const rangeStart = readEventDataValue<string>(event, "range_start_ledger_id");
  const rangeEnd = readEventDataValue<string>(event, "range_end_ledger_id");
  const chunkIndex = readEventDataValue<number>(event, "chunk_index");
  const algoVersion = readEventDataValue<string>(event, "algo_version");
  const topK = readEventDataValue<number>(event, "top_k");
  const queryHash = readEventDataValue<string>(event, "query_hash");
  const artifactPath = readEventDataValue<string>(event, "artifact_path");
  const alwaysCount = readEventDataValue<number>(event, "always_count");
  const rankedCount = readEventDataValue<number>(event, "ranked_count");
  const dbMs = readEventDataValue<number>(event, "db_ms");
  const error = readEventDataValue<string>(event, "error");
  const prompt = readEventDataValue<{ model?: string }>(event, "prompt");
  if (actionType) attrs.push(`action_type=${actionType}`);
  if (status) attrs.push(`status=${status}`);
  if (typeof attempt === "number") attrs.push(`attempt=${attempt}`);
  if (rangeStart && rangeEnd) {
    attrs.push(
      `range=${renderLineRef(rangeStart, ledgerIndexMap)}..${renderLineRef(rangeEnd, ledgerIndexMap)}`
    );
  }
  if (typeof chunkIndex === "number") attrs.push(`chunk=${chunkIndex}`);
  if (algoVersion) attrs.push(`algo=${algoVersion}`);
  if (typeof topK === "number") attrs.push(`top_k=${topK}`);
  if (queryHash) attrs.push(`q=${queryHash.slice(0, 8)}`);
  if (artifactPath) attrs.push(`artifact=${artifactPath}`);
  if (typeof alwaysCount === "number") attrs.push(`always=${alwaysCount}`);
  if (typeof rankedCount === "number") attrs.push(`ranked=${rankedCount}`);
  if (typeof dbMs === "number") attrs.push(`db_ms=${dbMs}`);
  if (error) attrs.push(`error=${error}`);
  if (prompt?.model) attrs.push(`model=${prompt.model}`);
  return `${anchor} ⚙ ${attrs.join(" ")}`.trim();
}

function getEventSortPriority(event: MeepoActionLogEvent): number {
  const name = event.event ?? event.event_type ?? "";
  if (name === "replay_start") return 0;
  if (name === "action-enqueued" || name === "action_enqueued") return 1;
  if (name === "action_claimed") return 2;
  if (name === "llm_prompt_dispatch") return 3;
  if (name === "action_done") return 4;
  if (name === "action_failed_retry" || name === "action_failed_terminal") return 5;
  if (name === "replay_end") return 6;
  return 7;
}

function compareLedgerIds(left: string, right: string): number {
  if (left === right) return 0;
  const leftNum = Number(left);
  const rightNum = Number(right);
  const leftIsFinite = Number.isFinite(leftNum);
  const rightIsFinite = Number.isFinite(rightNum);
  if (leftIsFinite && rightIsFinite) return leftNum - rightNum;
  return left.localeCompare(right);
}

function parseJsonlEvents(filePath: string): {
  transcriptLines: ParsedTranscriptLine[];
  events: ParsedNonTranscriptEvent[];
} {
  const rawLines = fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const transcriptLines: ParsedTranscriptLine[] = [];
  const events: ParsedNonTranscriptEvent[] = [];
  let ordinal = 0;

  for (const line of rawLines) {
    try {
      const parsed = JSON.parse(line) as MeepoActionLogEvent;
      const anchorLedgerId = parsed.anchor_ledger_id?.trim();

      const transcript = parsed.transcript_line;
      if (transcript) {
        if (!anchorLedgerId) continue;
        transcriptLines.push({
          anchorLedgerId,
          authorName: String(transcript.author_name ?? ""),
          content: String(transcript.content ?? ""),
          lineId:
            transcript.line_id === undefined || transcript.line_id === null
              ? undefined
              : String(transcript.line_id),
          ordinal,
        });
      } else {
        events.push({ event: parsed, ordinal });
      }
      ordinal += 1;
    } catch {
      continue;
    }
  }

  return { transcriptLines, events };
}

function findNearestPrecedingAnchor(eventAnchor: string, transcriptAnchors: string[]): string | null {
  let nearest: string | null = null;
  for (const anchor of transcriptAnchors) {
    if (compareLedgerIds(anchor, eventAnchor) <= 0) {
      nearest = anchor;
      continue;
    }
    break;
  }
  return nearest;
}

function mergeTranscriptAndEvents(args: {
  transcriptLines: ParsedTranscriptLine[];
  events: ParsedNonTranscriptEvent[];
  ledgerIndexMap: Map<string, number>;
}): string {
  const { transcriptLines, events, ledgerIndexMap } = args;

  const transcriptKeyToLine = new Map<string, ParsedTranscriptLine>();
  for (const line of transcriptLines) {
    const textPart = `${line.authorName}\n${line.content}`;
    const key = line.lineId
      ? `${line.anchorLedgerId}\n${line.lineId}`
      : `${line.anchorLedgerId}\n${textPart}`;
    if (!transcriptKeyToLine.has(key)) {
      transcriptKeyToLine.set(key, line);
    }
  }

  const uniqueTranscriptCount = transcriptKeyToLine.size;
  const linesByAnchor = new Map<string, ParsedTranscriptLine[]>();
  for (const line of transcriptKeyToLine.values()) {
    const bucket = linesByAnchor.get(line.anchorLedgerId) ?? [];
    bucket.push(line);
    linesByAnchor.set(line.anchorLedgerId, bucket);
  }
  for (const bucket of linesByAnchor.values()) {
    bucket.sort((left, right) => {
      if (left.lineId && right.lineId && left.lineId !== right.lineId) {
        return left.lineId.localeCompare(right.lineId);
      }
      return left.ordinal - right.ordinal;
    });
  }

  const transcriptAnchors = Array.from(linesByAnchor.keys()).sort(compareLedgerIds);

  const headerEvents: ParsedNonTranscriptEvent[] = [];
  const eventsByAnchor = new Map<string, ParsedNonTranscriptEvent[]>();
  for (const entry of events) {
    const anchor = entry.event.anchor_ledger_id?.trim() ?? "";
    const targetAnchor = linesByAnchor.has(anchor)
      ? anchor
      : findNearestPrecedingAnchor(anchor, transcriptAnchors);
    if (!targetAnchor) {
      headerEvents.push(entry);
      continue;
    }
    const bucket = eventsByAnchor.get(targetAnchor) ?? [];
    bucket.push(entry);
    eventsByAnchor.set(targetAnchor, bucket);
  }

  const eventComparator = (left: ParsedNonTranscriptEvent, right: ParsedNonTranscriptEvent): number => {
    const leftPriority = getEventSortPriority(left.event);
    const rightPriority = getEventSortPriority(right.event);
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    if (left.event.ts_ms !== right.event.ts_ms) return left.event.ts_ms - right.event.ts_ms;
    const leftAnchor = left.event.anchor_ledger_id?.trim() ?? "";
    const rightAnchor = right.event.anchor_ledger_id?.trim() ?? "";
    if (leftAnchor !== rightAnchor) {
      return compareLedgerIds(leftAnchor, rightAnchor);
    }
    if ((left.event.action_id ?? "") !== (right.event.action_id ?? "")) {
      return (left.event.action_id ?? "").localeCompare(right.event.action_id ?? "");
    }
    const leftName = left.event.event ?? left.event.event_type ?? "";
    const rightName = right.event.event ?? right.event.event_type ?? "";
    if (leftName !== rightName) {
      return leftName.localeCompare(rightName);
    }
    return left.ordinal - right.ordinal;
  };

  headerEvents.sort(eventComparator);
  for (const bucket of eventsByAnchor.values()) {
    bucket.sort(eventComparator);
  }

  const renderedLines: string[] = [];
  for (const headerEvent of headerEvents) {
    renderedLines.push(renderEventLine(headerEvent.event, ledgerIndexMap));
  }

  let renderedTranscriptCount = 0;
  let displayIndex = 0;
  for (const anchor of transcriptAnchors) {
    const transcriptBucket = linesByAnchor.get(anchor) ?? [];
    for (const transcriptLine of transcriptBucket) {
      renderedLines.push(renderTranscriptLine(transcriptLine, ledgerIndexMap, displayIndex));
      renderedTranscriptCount += 1;
      displayIndex += 1;
    }

    const eventBucket = eventsByAnchor.get(anchor) ?? [];
    for (const eventEntry of eventBucket) {
      renderedLines.push(renderEventLine(eventEntry.event, ledgerIndexMap));
    }
  }

  if (renderedTranscriptCount !== uniqueTranscriptCount) {
    throw new Error(
      `meepoActionLogging invariant failed: rendered transcript count (${renderedTranscriptCount}) does not match unique transcript count (${uniqueTranscriptCount})`
    );
  }

  return renderedLines.join("\n");
}

export function appendMeepoActionLogEvent(db: any, event: MeepoActionLogEvent): void {
  const eventName = resolveEventName(event);
  if (!eventName) return;
  if (!shouldWriteEvent({
    eventName,
    runKind: event.run_kind,
    scope: event.scope,
    sessionId: event.session_id,
  })) {
    return;
  }

  const includePromptBodies = boolFromEnv("MEEPO_ACTION_LOGGING_INCLUDE_PROMPTS", false);
  const normalizedBase = normalizeMeepoActionLogEvent(db, event);
  const normalized: MeepoActionLogEvent = {
    ...normalizedBase,
    prompt: (() => {
      const prompt = normalizedBase.prompt;
      if (!prompt) return undefined;
      if (includePromptBodies) return prompt;
      return {
        model: prompt.model,
        max_tokens: prompt.max_tokens,
      };
    })(),
  };
  if (normalized.prompt) {
    normalized.data = {
      ...(normalized.data ?? {}),
      prompt: normalized.prompt,
    };
  }

  const paths = resolveMeepoActionLogPaths(db, {
    guildId: normalized.guild_id,
    sessionId: normalized.session_id,
    runKind: normalized.run_kind,
  });
  fs.mkdirSync(path.dirname(paths.jsonlPath), { recursive: true });
  fs.appendFileSync(paths.jsonlPath, `${JSON.stringify(normalized)}\n`, "utf8");

  maybeAnnounceConsoleMirror();
  if (shouldMirrorToConsole()) {
    console.debug("[meepo_actions]", summarizeEventForConsole(normalized));
  }

  const dirtyKey = buildDirtyKey({
    runKind: normalized.run_kind,
    guildId: normalized.guild_id,
    scope: normalized.scope,
    sessionId: normalized.session_id,
  });
  dirtyKeys.add(dirtyKey);
}

export function flushDirtyMeepoActionMergedLogs(db: any, args?: { runKind?: MeepoActionRunKind }): string[] {
  const flushed: string[] = [];
  const keys = Array.from(dirtyKeys.values());
  for (const key of keys) {
    const parsed = parseDirtyKey(key);
    if (args?.runKind && parsed.runKind !== args.runKind) continue;
    if (!shouldWriteEvent({
      eventName: "flush",
      runKind: parsed.runKind,
      scope: parsed.scope,
      sessionId: parsed.sessionId,
    })) {
      dirtyKeys.delete(key);
      continue;
    }

    const paths = resolveMeepoActionLogPaths(db, {
      guildId: parsed.guildId,
      sessionId: parsed.sessionId,
      runKind: parsed.runKind,
    });

    if (!fs.existsSync(paths.jsonlPath)) {
      dirtyKeys.delete(key);
      continue;
    }

    const { transcriptLines, events } = parseJsonlEvents(paths.jsonlPath);

    const ledgerIndexMap = buildLedgerIndexMap(db, {
      guildId: parsed.guildId,
      scope: parsed.scope,
      sessionId: parsed.sessionId,
    });

    const rendered = includeTranscriptLinesInMergedLog()
      ? mergeTranscriptAndEvents({
          transcriptLines,
          events,
          ledgerIndexMap,
        })
      : events
          .sort((left, right) => left.ordinal - right.ordinal)
          .map((entry) => renderEventLine(entry.event, ledgerIndexMap))
          .join("\n");

    writeFileAtomic(paths.mergedLogPath, rendered.length > 0 ? `${rendered}\n` : "");
    flushed.push(paths.mergedLogPath);

    dirtyKeys.delete(key);
  }
  return flushed;
}

export function clearMeepoActionLogArtifacts(db: any, args: {
  guildId: string;
  sessionId: string;
  runKind: MeepoActionRunKind;
}): void {
  const paths = resolveMeepoActionLogPaths(db, {
    guildId: args.guildId,
    sessionId: args.sessionId,
    runKind: args.runKind,
  });
  if (fs.existsSync(paths.jsonlPath)) fs.rmSync(paths.jsonlPath, { force: true });
  if (fs.existsSync(paths.mergedLogPath)) fs.rmSync(paths.mergedLogPath, { force: true });

  const key = buildDirtyKey({
    runKind: args.runKind,
    guildId: args.guildId,
    scope: "canon",
    sessionId: args.sessionId,
  });
  dirtyKeys.delete(key);
}
