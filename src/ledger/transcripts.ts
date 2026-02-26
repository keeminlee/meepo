/**
 * Shared transcript builder for session ledger
 * 
 * Consolidates ledger querying logic used by both Meecap and Events tools.
 * Handles narrative_weight filtering upstream, always uses normalized content.
 *
 * Preferred source: bronze_transcript (pre-compiled, voice-fused).
 * Fallback: live query from ledger_entries (used when bronze hasn't been compiled).
 */

import { getDbForCampaign } from "../db.js";
import { getDefaultCampaignSlug } from "../campaign/defaultCampaign.js";

export interface TranscriptEntry {
  line_index: number;
  author_name: string;
  content: string;       // normalized content (fallback to raw if N/A)
  timestamp_ms: number;
}

export type TranscriptLineRange = {
  start: number;
  end: number;
};

export type TranscriptLineSelectorObject = {
  ranges?: TranscriptLineRange[];
  lines?: number[];
};

export type TranscriptLineSelector = number[] | TranscriptLineRange | TranscriptLineSelectorObject;

export interface TranscriptLineResult {
  line: number;
  text: string;
}

export interface TranscriptLineFetchResult {
  lines: TranscriptLineResult[];
  missing: number[];
}

export interface GetTranscriptLinesOptions {
  primaryOnly?: boolean;
  maxLines?: number;
  onMissing?: "skip" | "placeholder";
  db?: any;
}

function resolveTranscriptDb(db?: any): any {
  return db ?? getDbForCampaign(getDefaultCampaignSlug());
}

function toRequestedLineNumbers(selector: TranscriptLineSelector): number[] {
  const out = new Set<number>();

  if (Array.isArray(selector)) {
    for (const line of selector) {
      if (Number.isInteger(line) && line >= 0) {
        out.add(line);
      }
    }
    return Array.from(out).sort((a, b) => a - b);
  }

  const addRange = (range: TranscriptLineRange) => {
    const start = Number.isInteger(range.start) ? range.start : NaN;
    const end = Number.isInteger(range.end) ? range.end : NaN;
    if (Number.isNaN(start) || Number.isNaN(end)) {
      return;
    }

    const min = Math.max(0, Math.min(start, end));
    const max = Math.max(0, Math.max(start, end));
    for (let line = min; line <= max; line++) {
      out.add(line);
    }
  };

  // Object selector with both lines and ranges
  if ("ranges" in selector || "lines" in selector) {
    for (const line of selector.lines ?? []) {
      if (Number.isInteger(line) && line >= 0) {
        out.add(line);
      }
    }

    for (const range of selector.ranges ?? []) {
      addRange(range);
    }

    return Array.from(out).sort((a, b) => a - b);
  }

  addRange(selector as TranscriptLineRange);

  return Array.from(out).sort((a, b) => a - b);
}

/**
 * Load session transcript with consistent filtering.
 *
 * Prefers bronze_transcript (pre-compiled, voice-fused) when available.
 * Falls back to a live query from ledger_entries if bronze hasn't been compiled.
 *
 * @param sessionId - Session UUID
 * @param primaryOnly - If true, filters to narrative_weight='primary' only. Default: true
 *                      (ignored when reading from bronze, which is always primary)
 * @returns Array of transcript entries with stable line indices
 */
export function buildTranscript(
  sessionId: string,
  primaryOnly: boolean = true,
  db?: any
): TranscriptEntry[] {
  // Prefer bronze when available
  const bronze = tryGetBronzeTranscript(sessionId, db);
  if (bronze !== null) return bronze;

  // Fallback: live query from ledger_entries
  return buildTranscriptFromLedger(sessionId, primaryOnly, db);
}

/**
 * Build transcript directly from ledger_entries (bypasses bronze).
 * Use this only if you explicitly want the raw ledger view.
 */
export function buildTranscriptFromLedger(
  sessionId: string,
  primaryOnly: boolean = true,
  db?: any
): TranscriptEntry[] {
  const conn = resolveTranscriptDb(db);

  const narrativeWeightFilter = primaryOnly ? "AND narrative_weight = ?" : "";
  const params = primaryOnly ? [sessionId, "primary"] : [sessionId];

  const rows = conn
    .prepare(
      `SELECT author_name, content, content_norm, timestamp_ms
       FROM ledger_entries
       WHERE session_id = ?
         AND source IN ('text', 'voice', 'offline_ingest')
         ${narrativeWeightFilter}
       -- Important: this ordering defines transcript line ordinals used by event indexing.
       -- Keep this exactly aligned with event compilation line-index ordering.
       ORDER BY timestamp_ms ASC, id ASC`
    )
    .all(...params) as Array<{
      author_name: string;
      content: string;
      content_norm: string | null;
      timestamp_ms: number;
    }>;

  if (rows.length === 0) {
    throw new Error(
      `No transcript entries found for session ${sessionId}` +
        (primaryOnly ? " (filtered to primary narrative_weight)" : "")
    );
  }

  return rows.map((row, idx) => ({
    line_index: idx,
    author_name: row.author_name,
    content: row.content_norm ?? row.content, // Always prefer normalized
    timestamp_ms: row.timestamp_ms,
  }));
}

/**
 * Fetch selected transcript lines by explicit line list or line range.
 *
 * Output text is prompt-ready with [L#] prefix:
 *   [{ line: 39, text: "[L39] Alice: ..." }]
 */
export function getTranscriptLines(
  sessionId: string,
  lineNumbersOrRange: TranscriptLineSelector,
  opts?: GetTranscriptLinesOptions
): TranscriptLineResult[] {
  return getTranscriptLinesDetailed(sessionId, lineNumbersOrRange, opts).lines;
}

export function getTranscriptLinesDetailed(
  sessionId: string,
  lineNumbersOrRange: TranscriptLineSelector,
  opts?: GetTranscriptLinesOptions
): TranscriptLineFetchResult {
  const primaryOnly = opts?.primaryOnly ?? true;
  const maxLines = opts?.maxLines;
  const onMissing = opts?.onMissing ?? "skip";
  const transcript = buildTranscript(sessionId, primaryOnly, opts?.db);
  let requestedLines = toRequestedLineNumbers(lineNumbersOrRange);

  if (typeof maxLines === "number" && Number.isFinite(maxLines) && maxLines >= 0) {
    requestedLines = requestedLines.slice(0, Math.floor(maxLines));
  }

  const results: TranscriptLineResult[] = [];
  const missing: number[] = [];
  for (const line of requestedLines) {
    const entry = transcript[line];
    if (!entry) {
      missing.push(line);
      if (onMissing === "placeholder") {
        results.push({
          line,
          text: `[L${line}] (missing)`,
        });
      }
      continue;
    }

    results.push({
      line,
      text: `[L${line}] ${entry.author_name}: ${entry.content}`,
    });
  }

  return {
    lines: results,
    missing,
  };
}
// ── Bronze transcript reader ──────────────────────────────────────────────────

/**
 * Read bronze_transcript for a session. Returns null if not yet compiled.
 * Internal — callers should use buildTranscript() which auto-falls back.
 */
function tryGetBronzeTranscript(sessionId: string, db?: any): TranscriptEntry[] | null {
  const conn = resolveTranscriptDb(db);

  const rows = conn
    .prepare(
      `SELECT line_index, author_name, content, timestamp_ms
       FROM bronze_transcript
       WHERE session_id = ?
       ORDER BY line_index ASC`
    )
    .all(sessionId) as Array<{
      line_index: number;
      author_name: string;
      content: string;
      timestamp_ms: number;
    }>;

  if (rows.length === 0) return null;

  return rows.map((row) => ({
    line_index: row.line_index,
    author_name: row.author_name,
    content: row.content,
    timestamp_ms: row.timestamp_ms,
  }));
}

/**
 * Read bronze_transcript for a session.
 * Throws if bronze hasn't been compiled yet (use compile-transcripts first).
 */
export function getBronzeTranscript(sessionId: string, db?: any): TranscriptEntry[] {
  const rows = tryGetBronzeTranscript(sessionId, db);
  if (rows === null) {
    throw new Error(
      `No bronze transcript found for session ${sessionId}. ` +
        `Run: npx tsx src/tools/compile-transcripts.ts --session <LABEL>`
    );
  }
  return rows;
}

/**
 * Returns true if bronze_transcript has been compiled for this session.
 */
export function hasBronzeTranscript(sessionId: string, db?: any): boolean {
  return tryGetBronzeTranscript(sessionId, db) !== null;
}