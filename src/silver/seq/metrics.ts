import type { ClassifiedLine, Segment, SegmentationMetrics } from "./types.js";

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  const safeIndex = Math.max(0, Math.min(sorted.length - 1, index));
  return sorted[safeIndex];
}

export function computeSegmentationMetrics(
  segments: Segment[],
  classifiedLines: ClassifiedLine[],
): SegmentationMetrics {
  const narrativeLineIndices = classifiedLines
    .filter((item) => item.kind === "narrative")
    .map((item) => item.index)
    .sort((a, b) => a - b);

  const combatLineCount = classifiedLines.filter((item) => item.kind === "combat").length;

  const coveredNarrative = new Set<number>();
  for (const segment of segments) {
    for (let lineIndex = segment.startLineIndex; lineIndex <= segment.endLineIndex; lineIndex++) {
      const line = classifiedLines[lineIndex];
      if (line?.kind === "narrative") {
        coveredNarrative.add(lineIndex);
      }
    }
  }

  const uncoveredNarrativeLines = narrativeLineIndices.filter((index) => !coveredNarrative.has(index));
  const narrativeSizes = segments.map((segment) => segment.narrativeLineCount);
  const totalSizes = segments.map((segment) => segment.totalLineCount);

  const narrativeLinesTotal = narrativeLineIndices.length;
  const coverageNarrative =
    narrativeLinesTotal === 0
      ? 1
      : Number((coveredNarrative.size / narrativeLinesTotal).toFixed(6));

  return {
    numSegments: segments.length,
    narrativeLinesTotal,
    combatLinesTotal: combatLineCount,
    coverageNarrative,
    segmentNarrativeSizeDistribution: {
      p10: percentile(narrativeSizes, 10),
      p50: percentile(narrativeSizes, 50),
      p90: percentile(narrativeSizes, 90),
      p95: percentile(narrativeSizes, 95),
    },
    segmentTotalSizeDistribution: {
      p10: percentile(totalSizes, 10),
      p50: percentile(totalSizes, 50),
      p90: percentile(totalSizes, 90),
      p95: percentile(totalSizes, 95),
    },
    uncoveredNarrativeLines,
  };
}
