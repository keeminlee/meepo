import type { CausalLink } from "./types.js";

export type SingletonNode = {
  id: string;
  kind: "cause" | "effect";
  anchor_index: number;
  text: string;
  mass: number;
  type: string;
};

export type ContextEdge = {
  singleton_id: string;
  link_id: string;
  strength_ctx: number;
  distance: number;
  lexical: number;
  singleton_kind: "cause" | "effect";
  singleton_anchor_index: number;
  link_center_index: number;
  created_at_ms: number;
};

export type NeighborEdgeTrace = {
  from_link_id: string;
  to_link_id: string;
  strength_ll: number;
  contrib: number;
  distance: number;
  lexical: number;
};

export type MetricStats = {
  min: number;
  p50: number;
  p90: number;
  max: number;
};

export type CyclePhaseMetrics = {
  cycle: number;
  phase: "link" | "anneal";
  label: string;
  timestamp_ms: number;
  counts: Record<string, number>;
  stats: Record<string, MetricStats>;
  top_examples?: string[];
};

export type CyclePhaseState = {
  cycle: number;
  phase: "link" | "anneal";
  links: CausalLink[];
  singletonCauses: SingletonNode[];
  singletonEffects: SingletonNode[];
  contextEdges: ContextEdge[];
  neighborEdges: NeighborEdgeTrace[];
  metrics: CyclePhaseMetrics;
  massDeltaTsv?: string;
  contextByLinkId?: Map<string, string[]>;
};

export type CausalCyclesProvenance = {
  kernel_version: string;
  params_json: string;
  param_hash: string;
};
