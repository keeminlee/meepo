/**
 * scaffoldTypes.ts
 *
 * Type definitions for the deterministic event scaffold system.
 *
 * The event scaffold is a stable partitioning of a bronze transcript into
 * contiguous spans using heuristic DM-framing signals. It is produced
 * without LLM calls and provides bounded, debuggable chunks for downstream
 * LLM event labeling.
 */

// ── Enums ─────────────────────────────────────────────────────────────────────

/**
 * Why a boundary was placed at this span's start.
 */
export type BoundaryReason =
  | "dm_scene_set"     // DM sets a scene (location entry, descriptive framing)
  | "dm_hard_cut"      // DM says "cut to", "meanwhile", "later", etc.
  | "dm_time_skip"     // DM signals a time jump ("the next morning", "hours later")
  | "dm_initiative"    // DM triggers combat ("roll initiative", "roll for initiative")
  | "dm_phase_change"  // DM signals phase shift (short/long rest, "combat ends", etc.)
  | "dm_soft_confirm"  // DM soft confirmation opener ("okay so", "alright then")
  | "ooc_block"        // Extended OOC block detected
  | "fallback_split"   // Forced split due to maxSpanLines budget
  | "session_start";   // First span (always at line 0)

/** Signal hit from the signal detector. */
export interface SignalHit {
  pattern: string;     // Display name of the matching pattern
  category: SignalCategory;
  confidence: number;  // 0–1 strength of this individual signal
}

export type SignalCategory =
  | "hard_cut"
  | "time_skip"
  | "scene_set"
  | "initiative"
  | "phase_change"
  | "soft_confirm"
  | "ooc";

// ── Core scaffold entry ───────────────────────────────────────────────────────

export interface EventScaffold {
  /** Stable event ID within the session, e.g. "E0001" */
  event_id: string;

  session_id: string;

  /** 0-based inclusive start line index in bronze_transcript */
  start_index: number;

  /** 0-based inclusive end line index in bronze_transcript */
  end_index: number;

  /** Primary reason this boundary was placed */
  boundary_reason: BoundaryReason;

  /** Aggregate confidence (0–1) from signal hits */
  confidence: number;

  /** Fraction of lines in span spoken by DM (0–1) */
  dm_ratio: number;

  /** Signal patterns that fired at or near the boundary (debug) */
  signal_hits: string[];

  /** Sample lines from near boundary start (debug, not stored in DB) */
  sample_lines?: string[];
}

// ── Build options ─────────────────────────────────────────────────────────────

/**
 * Debug trace for a candidate boundary (for --trace output).
 */
export interface BoundaryTrace {
  lineIndex: number;
  speaker: string;
  signalNames: string[];
  confidence: number;
  accepted: boolean;
  reason?: string;  // why it was rejected, if not accepted
}

export interface ScaffoldOptions {
  /** Minimum span length in lines before a split is accepted. Default: 25 */
  minSpanLines?: number;

  /** Hard cap; spans larger than this get force-split. Default: 150 */
  maxSpanLines?: number;

  /** Budget; if total events exceed this, minSpanLines is inflated and re-run. Default: 80 */
  maxEvents?: number;

  /**
   * DM speaker names (lowercased). Lines from these authors count as DM lines.
   * Defaults to ["dm", "narrator", "dungeon master", "game master", "gm", "offline audio"].
   * Also extended by DM_SPEAKER env var (comma-separated).
   */
  dmNames?: string[];

  /** Include sample_lines in output (for debug/report only). Default: true */
  includeSampleLines?: boolean;
}
