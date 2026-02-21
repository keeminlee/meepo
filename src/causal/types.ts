export type IntentType = "question" | "declare" | "propose" | "request";
export type CauseType = IntentType;

export type ConsequenceType =
  | "roll"
  | "deterministic"
  | "information"
  | "commitment"
  | "dm_statement"  // Generic DM response within 5 lines of a PC intent
  | "other"
  | "none";
export type EffectType = Exclude<ConsequenceType, "none">;

export type RollType =
  | "Acrobatics"
  | "AnimalHandling"
  | "Arcana"
  | "Athletics"
  | "Deception"
  | "History"
  | "Insight"
  | "Intimidation"
  | "Investigation"
  | "Medicine"
  | "Nature"
  | "Perception"
  | "Performance"
  | "Persuasion"
  | "Religion"
  | "SleightOfHand"
  | "Stealth"
  | "Survival"
  | "AttackRoll"
  | "SavingThrow"
  | "DamageRoll"
  | "Initiative"
  | null;

/**
 * @deprecated Use CausalLink instead. CausalLoop retained for backward compatibility.
 */
export interface CausalLoop {
  id: string;
  session_id: string;
  chunk_id: string;
  chunk_index: number;
  actor: string;
  start_index: number;
  end_index: number;
  intent_text: string;
  intent_type: IntentType;
  consequence_type: ConsequenceType;
  roll_type: RollType;
  roll_subtype?: string | null;
  outcome_text: string;
  confidence: number;
  intent_anchor_index: number | null;
  consequence_anchor_index: number | null;
  created_at_ms: number;
}

/**
 * CausalLink: Deterministic intent → consequence chain (local, chunkless)
 * 
 * Extracted from eligible transcript lines (gated by eligibility mask).
 * Links run chunkless but reference session_id for grouping.
 * 
 * Fields:
 *   id              - UUID, unique within session
 *   session_id      - Session this link belongs to
 *   actor           - PC actor initiating the intent
 *   intent_text     - Full text of the intent line
 *   intent_type     - question | declare | propose | request
 *   intent_strength - strong | weak
 *   intent_anchor   - Line index of intent
 *   consequence_text- Full text of consequence (if claimed)
 *   consequence_type- roll | information | deterministic | commitment | dm_statement | other
 *   consequence_anchor - Line index of consequence (null if unclaimed)
 *   distance        - Lines between intent and consequence
 *   score           - Final allocation score
 *   claimed         - true if consequence was claimed by this intent
 *   created_at_ms   - Timestamp
 */
export interface CausalLink {
  id: string;
  session_id: string;
  cause_text?: string;
  cause_type?: CauseType;
  cause_anchor_index?: number;
  cause_mass?: number;
  effect_text?: string | null;
  effect_type?: EffectType | "none";
  effect_anchor_index?: number | null;
  effect_mass?: number;
  level?: 1 | 2 | 3;
  members?: [string, string];
  strength_bridge?: number;
  strength_internal?: number;
  join_center_distance?: number;
  join_lexical_score?: number;
  context_line_indices?: number[];
  strength?: number | null;
  strength_ce?: number | null;
  mass?: number;
  mass_base?: number;
  link_mass?: number;
  span_start_index?: number;
  span_end_index?: number;
  center_index?: number;
  mass_boost?: number;
  tier?: "link" | "beat" | "event" | "scene";
  context_count?: number;
  actor: string;
  intent_text: string;
  intent_type: IntentType;
  intent_strength: "strong" | "weak";
  intent_anchor_index: number;
  consequence_text: string | null;
  consequence_type: ConsequenceType;
  consequence_anchor_index: number | null;
  distance: number | null;
  score: number | null;
  claimed: boolean;
  created_at_ms: number;
}

/**
 * EligibilityMask: Line-by-line gating for chunkless causal link extraction
 * 
 * Produced by merging chunk-based exclusions (combat, OOC, table-talk).
 * Used to filter which lines can participate in intent/consequence pairing.
 * 
 * Representation can be either:
 *   A) Boolean array (indexed by line_index)
 *   B) Excluded ranges with reasons
 * 
 * We use (A) for fast O(1) lookups, populate from (B).
 */
export interface ExcludedRange {
  start_index: number;
  end_index: number;
  reason: "ooc_hard" | "ooc_soft" | "combat" | "transition" | "noise" | "ooc_refined";
}

export interface EligibilityMask {
  session_id: string;
  eligible_mask: boolean[]; // indexed by transcript line_index
  excluded_ranges: ExcludedRange[];
  compiled_at_ms: number;
}

/**
 * IntentDebugTrace: Detailed allocation trace for a single intent
 * 
 * Emitted during link allocation for debugging and QA.
 * Shows all candidates, scoring breakdown, final decision.
 */
export interface IntentDebugTrace {
  anchor_index: number;
  cause_anchor_index?: number;
  strength: "strong" | "weak";
  intent_kind: string; // question, declaration, etc.
  cause_kind?: string;
  cause_mass?: number;
  eligible: boolean;
  candidates: Array<{
    consequence_index: number;
    effect_index?: number;
    speaker: string;
    eligible: boolean;
    distance: number;
    distance_score: number;
    lexical_score: number;
    answer_boost: number;
    commentary_penalty: number;
    pronoun_boost: number;
    final_score: number;
    strength_ce?: number;
    effect_mass?: number;
    claimed_by?: string; // intent id if claimed
  }>;
  chosen_consequence_index?: number;
  chosen_effect_index?: number;
  chosen_score?: number;
  chosen_strength?: number;
  claim_reason?: "strong_precedence" | "score_threshold" | "no_candidate" | "mass_ordered_one_to_one";
}

