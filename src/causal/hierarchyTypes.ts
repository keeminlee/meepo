import type { NeighborEdgeTrace } from "./cycleTypes.js";
import type { CausalLink } from "./types.js";
import type { LinkLinkCandidate } from "./linkLinksKernel.js";

export type RoundPhase = "link" | "anneal";

export type RoundMetrics = {
  round: 1 | 2 | 3;
  phase: RoundPhase;
  label: string;
  timestamp_ms: number;
  counts: Record<string, number>;
  stats: Record<string, { min: number; p50: number; p90: number; max: number }>;
};

export type RoundPhaseState = {
  round: 1 | 2 | 3;
  phase: RoundPhase;
  nodes: CausalLink[];
  neighborEdges: NeighborEdgeTrace[];
  metrics: RoundMetrics;
  massDeltaTsv?: string;
  candidates?: LinkLinkCandidate[];
};
