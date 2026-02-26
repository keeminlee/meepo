import { expect, test } from "vitest";
import type { TranscriptEntry } from "../ledger/transcripts.js";
import {
  buildSegmentPayload,
  segmentByRawLineTarget,
  stableHash,
} from "../tools/meecaps/megameecapCore.js";

function buildFixtureLines(count: number): TranscriptEntry[] {
  const lines: TranscriptEntry[] = [];
  for (let i = 0; i < count; i++) {
    lines.push({
      line_index: i,
      author_name: i % 4 === 0 ? "DM" : i % 2 === 0 ? "Snowflake" : "Jamison",
      content: `Fixture line ${i}: deterministic megameecap dry-run validation content.`,
      timestamp_ms: 1_700_000_000_000 + i,
      source_type: "voice_fused",
      source_ids: [`src-${i}`],
    });
  }
  return lines;
}

function buildDryRunShape(lines: TranscriptEntry[]) {
  const segments = segmentByRawLineTarget(lines, 250);
  const previous: string[] = [];

  const calls = segments.map((segment) => {
    const payload = buildSegmentPayload({
      segment,
      transcriptLines: lines,
      previousMeecaps: previous,
      maxLlmLines: 200,
      contextSegments: 3,
      contextChars: 12000,
    });

    previous.push(`Synthetic prior meecap for ${segment.seg_id}.`);

    return {
      seg_id: payload.seg_id,
      start_index: payload.start_index,
      end_index: payload.end_index,
      lines_total: payload.lines_total,
      lines_sent: payload.lines_sent,
      context_chars_used: payload.context_chars_used,
      req_chars_estimate: payload.req_chars_estimate,
      sent_line_start: payload.sent_line_start,
      sent_line_end: payload.sent_line_end,
    };
  });

  return {
    transcript_hash: stableHash(lines),
    segments,
    calls,
    dry_run_hash: stableHash({ segments, calls }),
  };
}

test("megameecap dry-run shape is deterministic", () => {
  const lines = buildFixtureLines(1200);

  const hashes: string[] = [];
  for (let i = 0; i < 3; i++) {
    const shape = buildDryRunShape(lines);
    hashes.push(stableHash(shape));
  }

  expect(new Set(hashes).size).toBe(1);
});
