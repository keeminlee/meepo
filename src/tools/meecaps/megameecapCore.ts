import { createHash } from "node:crypto";
import type { TranscriptEntry } from "../../ledger/transcripts.js";

export type MegameecapSegment = {
  seg_id: string;
  start_index: number;
  end_index: number;
  line_count: number;
};

export type SegmentPayload = {
  seg_id: string;
  start_index: number;
  end_index: number;
  lines_total: number;
  lines_sent: number;
  sent_line_start: number;
  sent_line_end: number;
  context_chars_used: number;
  req_chars_estimate: number;
  current_segment_text: string;
  wrapped_transcript: string;
};

export function segmentByRawLineTarget(lines: TranscriptEntry[], targetLines: number): MegameecapSegment[] {
  const safeTarget = Math.max(1, Math.floor(targetLines));
  const segments: MegameecapSegment[] = [];

  for (let start = 0; start < lines.length; start += safeTarget) {
    const end = Math.min(lines.length - 1, start + safeTarget - 1);
    const segNumber = segments.length + 1;
    segments.push({
      seg_id: `SEG_${String(segNumber).padStart(4, "0")}`,
      start_index: start,
      end_index: end,
      line_count: end - start + 1,
    });
  }

  return segments;
}

export function formatTranscriptLines(lines: TranscriptEntry[]): string {
  return lines.map((line) => `[L${line.line_index}] ${line.author_name}: ${line.content}`).join("\n");
}

export function clampContextTexts(previousMeecaps: string[], contextSegments: number, contextChars: number): string[] {
  const safeSegments = Math.max(0, Math.floor(contextSegments));
  const safeChars = Math.max(0, Math.floor(contextChars));

  if (safeSegments === 0 || safeChars === 0 || previousMeecaps.length === 0) {
    return [];
  }

  const selected = previousMeecaps.slice(Math.max(0, previousMeecaps.length - safeSegments));
  const out: string[] = [];
  let used = 0;
  const separator = "\n\n";

  for (let i = selected.length - 1; i >= 0; i--) {
    const text = selected[i] ?? "";
    if (!text) continue;

    const separatorCost = out.length > 0 ? separator.length : 0;
    const remaining = safeChars - used - separatorCost;
    if (remaining <= 0) break;

    const keep = text.length <= remaining ? text : text.slice(text.length - remaining);
    out.unshift(keep);
    used += keep.length + separatorCost;
  }

  return out;
}

export function buildWrappedSegmentTranscript(args: {
  contextTexts: string[];
  currentSegmentText: string;
}): { wrappedTranscript: string; contextCharsUsed: number } {
  const contextCharsUsed = args.contextTexts.reduce((sum, item) => sum + item.length, 0);
  const contextBody = args.contextTexts.length > 0 ? args.contextTexts.join("\n\n") : "(none)";

  const wrappedTranscript = [
    "PRIOR CONTEXT (previous segment meecaps; for continuity only):",
    contextBody,
    "",
    "CURRENT SEGMENT TRANSCRIPT (chronological lines; cite [line_index] in your summary):",
    args.currentSegmentText,
    "",
    "Do not invent events not supported by CURRENT SEGMENT lines; use prior context only for continuity.",
  ].join("\n");

  return {
    wrappedTranscript,
    contextCharsUsed,
  };
}

export function buildSegmentPayload(args: {
  segment: MegameecapSegment;
  transcriptLines: TranscriptEntry[];
  previousMeecaps: string[];
  maxLlmLines: number;
  contextSegments: number;
  contextChars: number;
}): SegmentPayload {
  const segmentLines = args.transcriptLines.slice(args.segment.start_index, args.segment.end_index + 1);
  const safeMaxLlmLines = Math.max(1, Math.floor(args.maxLlmLines));
  const sentLines = segmentLines.slice(0, safeMaxLlmLines);
  const currentSegmentText = formatTranscriptLines(sentLines);

  const contextTexts = clampContextTexts(args.previousMeecaps, args.contextSegments, args.contextChars);
  const wrapped = buildWrappedSegmentTranscript({
    contextTexts,
    currentSegmentText,
  });

  return {
    seg_id: args.segment.seg_id,
    start_index: args.segment.start_index,
    end_index: args.segment.end_index,
    lines_total: segmentLines.length,
    lines_sent: sentLines.length,
    sent_line_start: sentLines[0]?.line_index ?? args.segment.start_index,
    sent_line_end: sentLines[sentLines.length - 1]?.line_index ?? args.segment.start_index,
    context_chars_used: wrapped.contextCharsUsed,
    req_chars_estimate: wrapped.wrappedTranscript.length,
    current_segment_text: currentSegmentText,
    wrapped_transcript: wrapped.wrappedTranscript,
  };
}

export function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
