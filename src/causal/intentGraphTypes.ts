export type IntentNode = {
  intent_id: string;
  session_id: string;
  chunk_id: string;
  actor_id: string;
  anchor_index: number;
  intent_type: "question" | "declare" | "propose" | "request";
  text: string;
  source: "pc_line" | "bundle_yesno";
  buffer_intent?: boolean;
  is_strong_intent?: boolean;
};

export type ConsequenceNode = {
  consequence_id: string;
  session_id: string;
  chunk_id: string;
  anchor_index: number;
  consequence_type: "roll" | "information" | "deterministic" | "commitment" | "dm_statement" | "other";
  roll_type?: string | null;
  roll_subtype?: string | null;
  text: string;
  buffer_cons?: boolean;
};

export type CandidateEdge = {
  edge_id: string;
  session_id: string;
  chunk_id: string;
  intent_id: string;
  consequence_id: string;
  distance: number;
  distance_score: number;
  lexical_score: number;
  heuristic_boost: number;
  base_score: number;
  adjusted_score: number;
  shared_terms: string[];
  flags: {
    answer_form?: boolean;
    roll_request?: boolean;
    mentions_actor?: boolean;
    bundle_yesno?: boolean;
    buffer_intent?: boolean;
    buffer_cons?: boolean;
    question_to_answer?: boolean;
  };
};

export type LinkGraphNode = {
  link_id: string;
  session_id: string;
  actor_id: string;
  cause_anchor_index: number;
  effect_anchor_index: number | null;
  center_index: number;
  claimed: boolean;
  cause_type: string;
  effect_type: string;
  strength: number | null;
  mass_base: number | null;
  mass: number | null;
  mass_boost: number | null;
  text: string;
};

export type LinkGraphEdge = {
  edge_id: string;
  session_id: string;
  source_link_id: string;
  target_link_id: string;
  center_distance: number;
  distance_strength: number;
  lexical_overlap: number;
  strength_ll: number;
};

export type GraphParams = {
  buffer: number;
  maxBack: number;
  topK: number;
  lambda: number; // deprecated - use distTau/distP instead
  alphaLex: number; // deprecated - use betaLex instead
  beta: number;
  iters: number;
  distTau: number; // Hill curve half-max distance (default 2)
  distP: number; // Hill curve steepness exponent (default 2.2)
  lexK: number; // lexical saturation constant (default auto-calibrated)
  betaLex: number; // lexical multiplier weight (default 0.6)
};

export function makeIntentId(sessionId: string, actorId: string, anchorIndex: number): string {
  return `I:${sessionId}:${actorId}:${anchorIndex}`;
}

export function makeConsequenceId(sessionId: string, anchorIndex: number): string {
  return `C:${sessionId}:${anchorIndex}`;
}

export function makeEdgeId(intentId: string, consequenceId: string): string {
  return `E:${intentId}:${consequenceId}`;
}
