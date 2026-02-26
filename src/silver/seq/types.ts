import type { TranscriptEntry } from "../../ledger/transcripts.js";

export type LineKind = "narrative" | "combat" | "ooc" | "noise";

export type CombatMode = "prune" | "include" | "include_not_counted";

export interface Segment {
  id: string;
  startLineIndex: number;
  endLineIndex: number;
  narrativeLineCount: number;
  totalLineCount: number;
}

export interface SegmentTranscriptInput {
  lines: TranscriptEntry[];
  targetNarrativeLines: number;
  minNarrativeLines: number;
  maxNarrativeLines: number;
  snapWindow: number;
  combatMode?: CombatMode;
  pruneRegime?: string;
  countAllLines?: boolean;
}

export interface SegmentNarrativeSizeDistribution {
  p10: number;
  p50: number;
  p90: number;
  p95: number;
}

export interface SegmentationMetrics {
  numSegments: number;
  narrativeLinesTotal: number;
  combatLinesTotal: number;
  coverageNarrative: number;
  segmentNarrativeSizeDistribution: SegmentNarrativeSizeDistribution;
  segmentTotalSizeDistribution: SegmentNarrativeSizeDistribution;
  uncoveredNarrativeLines: number[];
}

export interface SegmentationResult {
  segments: Segment[];
  metrics: SegmentationMetrics;
}

export interface ClassifiedLine {
  index: number;
  kind: LineKind;
  line: TranscriptEntry;
}
