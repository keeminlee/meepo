/**
 * Two-lever evidence → strength pipeline for causal chunking.
 * - Evidence E ∈ [0,1]: bounded mix of distance (D), lexical (L), optional keyword/salience (K).
 * - Strength S = scale * E^γ: one coupling knob (γ).
 * - Merge threshold T = T0 + η·g(mA, mB): growth resistance (η).
 */

/** Weights for evidence mix (fixed). Distance dominant. */
const EVIDENCE_WEIGHT_DISTANCE = 0.7;
const EVIDENCE_WEIGHT_LEXICAL = 0.3;

/**
 * Combine distance and lexical evidence into E ∈ [0,1].
 * Optional K (e.g. answer/roll boost) is added and clamped.
 */
export function evidenceFromDistanceLexical(
  distanceEvidence: number,
  lexicalEvidence: number,
  optionalBoost?: number
): number {
  const e = EVIDENCE_WEIGHT_DISTANCE * distanceEvidence + EVIDENCE_WEIGHT_LEXICAL * lexicalEvidence;
  return Math.min(1, Math.max(0, e + (optionalBoost ?? 0)));
}

/**
 * Map evidence to strength: S = scale * E^γ.
 * γ < 1: forgiving; γ = 1: linear; γ > 1: strict.
 */
export function evidenceToStrength(E: number, gamma: number, scale: number = 2): number {
  if (E <= 0) return 0;
  return scale * Math.pow(E, gamma);
}

/**
 * Merge threshold: T = T0 + η·log(1 + √(mA·mB)).
 * Higher η = larger blobs harder to merge.
 */
export function mergeThreshold(mA: number, mB: number, T0: number, eta: number): number {
  return T0 + eta * Math.log(1 + Math.sqrt(Math.max(0, mA) * Math.max(0, mB)));
}

/** Locality (0–1) → hill tau. Higher locality = smaller tau = faster distance decay. */
export function localityToTau(locality: number): number {
  return 4 + 4 * (1 - Math.max(0, Math.min(1, locality)));
}

export type LeverParams = {
  /** How quickly evidence decays with distance (0–1; default 0.7 → tau ~5.2). */
  locality: number;
  /** Evidence → strength exponent (default 1.0). */
  coupling: number;
  /** Mass → merge threshold (default 0.15). */
  growth_resistance: number;
  /** Base merge threshold (default 1.0). */
  thresholdBase?: number;
  /** Scale for S so range matches legacy strength (default 2). */
  strengthScale?: number;
  /** Extra multiplier for lexical overlap when overlap contains detection-trigger keywords. */
  keywordLexBonus?: number;
};

export const DEFAULT_LEVERS: LeverParams = {
  locality: 0.7,
  coupling: 1.0,
  growth_resistance: 0.15,
  thresholdBase: 1.0,
  strengthScale: 2,
  keywordLexBonus: 0.25,
};
