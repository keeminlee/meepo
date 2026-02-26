import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import type { TranscriptEntry } from "../ledger/transcripts.js";
import { segmentTranscript } from "../silver/seq/segmentTranscript.js";

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function buildFixtureLines(count: number): TranscriptEntry[] {
  const lines: TranscriptEntry[] = [];
  for (let i = 0; i < count; i++) {
    lines.push({
      line_index: i,
      author_name: i % 7 === 0 ? "DM" : i % 2 === 0 ? "Panda" : "Keen",
      content:
        i % 53 === 0
          ? "(ooc) quick rules check"
          : i % 47 === 0
            ? "roll initiative and attack roll"
            : `Narrative line ${i}: we continue the journey through pan pan land.`,
      timestamp_ms: 1_700_000_000_000 + i,
      source_type: "voice_fused",
      source_ids: [`src-${i}`],
    });
  }
  return lines;
}

test("silver-seq segments and metrics are deterministic across 5 runs", () => {
  const lines = buildFixtureLines(1200);

  const segmentHashes: string[] = [];
  const metricHashes: string[] = [];

  for (let i = 0; i < 5; i++) {
    const result = segmentTranscript({
      lines,
      targetNarrativeLines: 240,
      minNarrativeLines: 200,
      maxNarrativeLines: 320,
      snapWindow: 30,
      combatMode: "prune",
      pruneRegime: "v1_default",
    });

    segmentHashes.push(stableHash({ segments: result.segments }));
    metricHashes.push(stableHash(result.metrics));
  }

  expect(new Set(segmentHashes).size).toBe(1);
  expect(new Set(metricHashes).size).toBe(1);
});
