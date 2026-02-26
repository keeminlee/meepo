import { expect, test } from "vitest";
import type { TranscriptEntry } from "../ledger/transcripts.js";
import { segmentTranscript } from "../silver/seq/segmentTranscript.js";

function buildFixtureLines(count: number): TranscriptEntry[] {
  const lines: TranscriptEntry[] = [];
  for (let i = 0; i < count; i++) {
    lines.push({
      line_index: i,
      author_name: i % 9 === 0 ? "DM" : i % 2 === 0 ? "Panda" : "Keen",
      content:
        i % 71 === 0
          ? "(ooc) quick table logistics"
          : i % 53 === 0
            ? "roll initiative and take an attack roll"
            : `Narrative line ${i}: the party advances through the scene with intent and consequence.`,
      timestamp_ms: 1_700_000_000_000 + i,
      source_type: "voice_fused",
      source_ids: [`src-${i}`],
    });
  }
  return lines;
}

test("silver-seq metrics contract (wide bounds)", () => {
  const lines = buildFixtureLines(6000);

  const result = segmentTranscript({
    lines,
    targetNarrativeLines: 240,
    minNarrativeLines: 200,
    maxNarrativeLines: 320,
    snapWindow: 30,
    combatMode: "prune",
    pruneRegime: "v1_default",
  });

  expect(result.metrics.numSegments).toBeGreaterThan(0);
  expect(result.metrics.coverageNarrative).toBeGreaterThanOrEqual(0.85);
  expect(result.metrics.segmentNarrativeSizeDistribution.p95).toBeLessThanOrEqual(450);
  expect(result.metrics.segmentNarrativeSizeDistribution.p10).toBeGreaterThanOrEqual(50);
});
