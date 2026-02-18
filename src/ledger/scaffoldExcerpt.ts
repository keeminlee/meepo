/**
 * scaffoldExcerpt.ts
 *
 * Deterministic excerpt generation for scaffold spans.
 *
 * Strategy:
 * - If span ≤ maxLines: include entire span
 * - If span > maxLines: head N + tail N (drop middle)
 * - Format: [L#] AuthorName: content (one line per transcript entry)
 * - Optional context: include 1 line before/after if available
 */

import type { TranscriptEntry } from "./transcripts.js";

export interface ExcerptOptions {
  /** Max lines in final excerpt. Default: 60 */
  maxLines?: number;

  /** If true, try to include DM signal lines in preference when dropping. Default: false */
  preferDmSignals?: boolean;

  /** If true, include 1 context line before start + after end. Default: true */
  includeContext?: boolean;
}

const DEFAULT_MAX_LINES = 60;
const DEFAULT_HEAD_TAIL_SPLIT = 30; // 30 head + 30 tail

/**
 * Build a deterministic excerpt for a scaffold span.
 * Same input → same output (deterministic for reproducibility).
 *
 * @param lines - All transcript lines (indexed by line_index)
 * @param startIndex - Inclusive start index of span
 * @param endIndex - Inclusive end index of span
 * @param opts - Configuration
 * @returns Formatted excerpt string
 */
export function buildExcerpt(
  lines: TranscriptEntry[],
  startIndex: number,
  endIndex: number,
  opts: ExcerptOptions = {}
): string {
  const maxLines = opts.maxLines ?? DEFAULT_MAX_LINES;
  const includeContext = opts.includeContext ?? true;

  // Clamp to valid range
  const start = Math.max(0, startIndex);
  const end = Math.min(lines.length - 1, endIndex);

  if (start > end || start >= lines.length) {
    return "(empty span)";
  }

  // Include optional context lines
  let contextStart = start;
  let contextEnd = end;

  if (includeContext) {
    if (start > 0) contextStart = start - 1;
    if (end < lines.length - 1) contextEnd = end + 1;
  }

  const spanLines = lines.slice(contextStart, contextEnd + 1);

  // If within budget, return full span
  if (spanLines.length <= maxLines) {
    return formatLines(spanLines, contextStart);
  }

  // Otherwise: head + tail strategy (drop middle)
  const headCount = Math.floor(maxLines / 2);
  const tailCount = maxLines - headCount;

  const head = spanLines.slice(0, headCount);
  const tail = spanLines.slice(-tailCount);
  const ellipsis = `\n... (${spanLines.length - maxLines} lines omitted) ...\n`;

  return (
    formatLines(head, contextStart) +
    ellipsis +
    formatLines(tail, contextStart + spanLines.length - tailCount)
  );
}

/**
 * Format transcript entries as "[L#] AuthorName: content" lines.
 *
 * @param entries - Subset of transcript
 * @param startLineIndex - Original line index of first entry (for [L#] numbering)
 */
function formatLines(entries: TranscriptEntry[], startLineIndex: number): string {
  return entries
    .map((line, idx) => {
      const lineNum = startLineIndex + idx;
      return `[L${lineNum}] ${line.author_name}: ${line.content}`;
    })
    .join("\n");
}

/**
 * Estimate token count for prompt (rough heuristic).
 * Used to warn if batch exceeds token budget.
 */
export function estimateTokens(text: string): number {
  // Rough estimate: ~4 chars per token
  return Math.ceil(text.length / 4);
}

/**
 * Build excerpt for multiple spans and estimate total tokens.
 *
 * @param lines - All transcript lines
 * @param spans - Array of (start, end) tuples
 * @returns { excerpts: string[], tokenEstimate: number }
 */
export function buildExcerptsForBatch(
  lines: TranscriptEntry[],
  spans: Array<{ start_index: number; end_index: number }>,
  opts: ExcerptOptions = {}
): { excerpts: string[]; totalTokens: number } {
  const excerpts = spans.map((span) =>
    buildExcerpt(lines, span.start_index, span.end_index, opts)
  );

  const totalTokens = excerpts.reduce((sum, e) => sum + estimateTokens(e), 0);

  return { excerpts, totalTokens };
}
