/**
 * extractCausalLinksKernel.ts: Chunkless causal link extraction (MVP)
 * 
 * Deterministic cause → effect pairing with local scoring.
 * Runs line-by-line over eligible lines (gated by EligibilityMask).
 * No chunk propagation into scoring; chunks only used for eligibility.
 * 
 * Core logic:
 *   Pass 1: Detect all causes in eligible PC lines with mass
 *   Pass 2: For each cause, find local DM effect candidates
 *   Pass 3: Mass-ordered one-to-one allocation (exclusive effects)
 *   Pass 4: Link↔Link neighborhood mass boosting
 *   Output: CausalLink[] with allocation traces (optional)
 */

import { randomUUID } from "node:crypto";
import type { TranscriptEntry } from "../ledger/transcripts.js";
import { detectCause, type CauseDetection } from "./detectIntent.js";
import { detectEffect, type EffectDetection } from "./detectConsequence.js";
import { distanceScoreHill, isYesNoAnswerLike, normalizeName } from "./textFeatures.js";
import type { ActorLike } from "./actorFeatures.js";
import { isLineEligible } from "./eligibilityMask.js";
import type { CausalLink, IntentDebugTrace, EligibilityMask } from "./types.js";
import { isDmSpeaker } from "../ledger/scaffoldSpeaker.js";

export const CAUSAL_KERNEL_VERSION = "ce-mass-v2";

export interface KernelInput {
  sessionId: string;
  transcript: TranscriptEntry[];
  eligibilityMask: EligibilityMask;
  actors: ActorLike[];
  dmSpeaker: Set<string>;
  kLocal?: number;
  strongMinScore?: number;
  weakMinScore?: number;
  minPairStrength?: number;
  hillTau?: number;
  hillSteepness?: number;
  betaLex?: number;
  betaLexLL?: number;
  linkWindow?: number;
  linkBoostDamping?: number;
  requireClaimedNeighbors?: boolean;
}

export interface KernelOutput {
  links: CausalLink[];
  traces?: IntentDebugTrace[];
  effects?: KernelEffect[];
  unclaimedEffects?: KernelEffect[];
}

export interface KernelEffect {
  anchor_index: number;
  text: string;
  effect_type: string;
  mass: number;
}

interface ScoredCandidate {
  effectIndex: number;
  effectLineIndex: number;
  distance: number;
  distanceScore: number;
  lexicalScore: number;
  answerBoost: number;
  strength_ce: number;
  effectDetection: EffectDetection;
}

const K_LOCAL_DEFAULT = 8;
const STRONG_MIN_SCORE_DEFAULT = 1.0;
const WEAK_MIN_SCORE_DEFAULT = 1.0;
const HILL_TAU_DEFAULT = 8;
const HILL_STEEPNESS_DEFAULT = 2.2;
const BETA_LEX_DEFAULT = 2.0;
const BETA_LEX_LL_DEFAULT = 0.8;
const LINK_WINDOW_DEFAULT = 18;
const LINK_BOOST_DAMPING_DEFAULT = 0.15;

/**
 * Simple lexical overlap scorer
 */
function scoreTokenOverlap(text1: string, text2: string): number {
  const tokens1 = new Set(text1.toLowerCase().split(/\s+/).filter((t) => t.length > 2));
  const tokens2 = new Set(text2.toLowerCase().split(/\s+/).filter((t) => t.length > 2));
  
  if (tokens1.size === 0 || tokens2.size === 0) return 0;
  
  const overlap = Array.from(tokens1).filter((t) => tokens2.has(t)).length;
  return overlap / Math.max(tokens1.size, tokens2.size);
}

function classifyLegacyStrength(mass: number): "strong" | "weak" {
  return mass >= 0.7 ? "strong" : "weak";
}

/**
 * Match PC speaker from line
 */
function matchPcSpeaker<T extends ActorLike>(speaker: string, actors: T[]): T | null {
  const normSpeaker = normalizeName(speaker);
  if (!normSpeaker) return null;

  let best: T | null = null;
  let bestLen = 0;

  for (const actor of actors) {
    const names = [actor.canonical_name, ...(actor.aliases ?? [])];
    for (const name of names) {
      const normName = normalizeName(name);
      if (!normName) continue;
      if (normSpeaker === normName || normSpeaker.includes(normName)) {
        if (normName.length > bestLen) {
          best = actor;
          bestLen = normName.length;
        }
      }
    }
  }

  return best;
}

/**
 * Score a single cause-effect pair
 */
function scoreCandidate(
  causeText: string,
  effectText: string,
  distance: number,
  hillTau: number,
  hillSteepness: number,
  betaLex: number,
  effectDetection: EffectDetection,
): Omit<ScoredCandidate, "effectIndex" | "effectLineIndex"> {
  // Distance score: Hill curve
  const distanceScore = distanceScoreHill(distance, hillTau, hillSteepness);

  // Lexical overlap
  const lexicalScore = scoreTokenOverlap(causeText, effectText);

  // Answer boost
  const answerBoost = isYesNoAnswerLike(effectText) ? 0.15 : 0;

  // Final: distance-first with lexical as multiplier
  const strength_ce = distanceScore * (1 + lexicalScore * betaLex) + answerBoost;

  return {
    distance,
    distanceScore,
    lexicalScore,
    answerBoost,
    strength_ce,
    effectDetection,
  };
}

function thresholdForCauseMass(mass: number, strongMinScore: number, weakMinScore: number, minPairStrength?: number): number {
  if (typeof minPairStrength === "number") return minPairStrength;
  return mass >= 0.7 ? strongMinScore : weakMinScore;
}

function getLinkText(link: CausalLink): string {
  const causeText = link.cause_text ?? link.intent_text;
  const effectText = link.effect_text ?? link.consequence_text ?? "";
  return `${causeText} ${effectText}`.trim();
}

function getCenterIndex(link: CausalLink): number {
  const cause = link.cause_anchor_index ?? link.intent_anchor_index;
  const effect = link.effect_anchor_index ?? link.consequence_anchor_index;
  if (typeof effect === "number") return Math.round((cause + effect) / 2);
  return cause;
}

function boostLinkMasses(
  links: CausalLink[],
  hillTau: number,
  hillSteepness: number,
  betaLexLL: number,
  linkWindow: number,
  damping: number,
  requireClaimedNeighbors: boolean,
): void {
  const centers = links.map(getCenterIndex);
  const texts = links.map(getLinkText);
  const baseMass = links.map((l) => l.link_mass ?? l.mass ?? l.cause_mass ?? 0);

  for (let i = 0; i < links.length; i++) {
    let bonus = 0;
    for (let j = 0; j < links.length; j++) {
      if (i === j) continue;
      if (requireClaimedNeighbors && !links[j].claimed) continue;

      const centerDistance = Math.abs(centers[i] - centers[j]);
      if (centerDistance > linkWindow) continue;

      const distStrength = distanceScoreHill(centerDistance, hillTau, hillSteepness);
      const lexicalOverlap = scoreTokenOverlap(texts[i], texts[j]);
      const strengthLL = distStrength * (1 + betaLexLL * lexicalOverlap);
      bonus += strengthLL * baseMass[j];
    }

    const dampedBonus = bonus * damping;
    links[i].mass_boost = dampedBonus;
    links[i].link_mass = baseMass[i] + dampedBonus;
    links[i].mass = links[i].link_mass;
    links[i].center_index = centers[i];
  }
}

/**
 * Main kernel
 */
export function extractCausalLinksKernel(input: KernelInput, emitTraces: boolean = false): KernelOutput {
  const {
    sessionId,
    transcript,
    eligibilityMask,
    actors,
    dmSpeaker,
    kLocal = K_LOCAL_DEFAULT,
    strongMinScore = STRONG_MIN_SCORE_DEFAULT,
    weakMinScore = WEAK_MIN_SCORE_DEFAULT,
    minPairStrength,
    hillTau = HILL_TAU_DEFAULT,
    hillSteepness = HILL_STEEPNESS_DEFAULT,
    betaLex = BETA_LEX_DEFAULT,
    betaLexLL = BETA_LEX_LL_DEFAULT,
    linkWindow = LINK_WINDOW_DEFAULT,
    linkBoostDamping = LINK_BOOST_DAMPING_DEFAULT,
    requireClaimedNeighbors = true,
  } = input;

  const links: CausalLink[] = [];
  const traces: IntentDebugTrace[] = [];
  const effects: KernelEffect[] = [];

  // Collect all causes and effects
  const causes: Array<{
    index: number;
    actor: ActorLike;
    text: string;
    detection: CauseDetection;
    mass: number;
  }> = [];

  for (let i = 0; i < transcript.length; i++) {
    const line = transcript[i];

    if (!isLineEligible(eligibilityMask, i)) continue;
    if (isDmSpeaker(line.author_name, dmSpeaker)) continue;

    const actor = matchPcSpeaker(line.author_name, actors);
    if (!actor) continue;

    const detection = detectCause(line.content);
    if (!detection.isCause) continue;

    causes.push({
      index: i,
      actor,
      text: line.content,
      detection,
      mass: detection.mass,
    });
  }

  for (let i = 0; i < transcript.length; i++) {
    const line = transcript[i];
    if (!isLineEligible(eligibilityMask, i)) continue;
    if (!isDmSpeaker(line.author_name, dmSpeaker)) continue;
    const detection = detectEffect(line.content);
    if (!detection.isEffect) continue;

    effects.push({
      anchor_index: line.line_index,
      text: line.content,
      effect_type: detection.effect_type,
      mass: detection.mass,
    });
  }

  // Track claimed effects
  const claimedEffects = new Set<number>();

  interface CandidateWithDmDistance {
    line: TranscriptEntry;
    arrayIndex: number;
    dmSpeakerDistance: number;
  }

  // Single pass: causes by descending mass (deterministic ties by line index)
  const sortedCauses = [...causes].sort((a, b) => {
    if (b.mass !== a.mass) return b.mass - a.mass;
    return a.index - b.index;
  });

  for (const cause of sortedCauses) {
    // Find local effect candidates (by DM speaker distance, not absolute line distance)
    const candidates: CandidateWithDmDistance[] = [];
    let dmLineCount = 0;
    
    for (let i = cause.index + 1; i < transcript.length && dmLineCount < kLocal; i++) {
      if (!isLineEligible(eligibilityMask, i)) continue;
      if (!isDmSpeaker(transcript[i].author_name, dmSpeaker)) continue;
      dmLineCount++;
      candidates.push({
        line: transcript[i],
        arrayIndex: i,
        dmSpeakerDistance: dmLineCount,
      });
    }

    if (candidates.length === 0) {
      const legacyStrength = classifyLegacyStrength(cause.mass);
      const spanStart = cause.index;
      const spanEnd = cause.index;
      links.push({
        id: randomUUID(),
        session_id: sessionId,
        cause_text: cause.text,
        cause_type: cause.detection.cause_type,
        cause_anchor_index: cause.index,
        cause_mass: cause.mass,
        effect_text: null,
        effect_type: "none",
        effect_anchor_index: null,
        effect_mass: 0,
        level: 1,
        members: undefined,
        strength_bridge: 0,
        strength_internal: 0,
        strength: null,
        strength_ce: null,
        link_mass: cause.mass,
        mass_boost: 0,
        span_start_index: spanStart,
        span_end_index: spanEnd,
        center_index: cause.index,
        mass: cause.mass,
        actor: cause.actor.id,
        intent_text: cause.text,
        intent_type: cause.detection.cause_type,
        intent_strength: legacyStrength,
        intent_anchor_index: cause.index,
        consequence_text: null,
        consequence_type: "none",
        consequence_anchor_index: null,
        distance: null,
        score: null,
        claimed: false,
        created_at_ms: Date.now(),
      });

      if (emitTraces) {
        traces.push({
          anchor_index: cause.index,
          cause_anchor_index: cause.index,
          strength: legacyStrength,
          intent_kind: cause.detection.cause_type,
          cause_kind: cause.detection.cause_type,
          cause_mass: cause.mass,
          eligible: true,
          candidates: [],
          claim_reason: "no_candidate",
        });
      }
      continue;
    }

    // Score candidates using DM speaker distance
    const scored = candidates.map(({ line: cLine, arrayIndex, dmSpeakerDistance }) => {
      const effectDetection = detectEffect(cLine.content);
      const base = scoreCandidate(cause.text, cLine.content, dmSpeakerDistance, hillTau, hillSteepness, betaLex, effectDetection);
      return {
        ...base,
        effectIndex: arrayIndex,
        effectLineIndex: cLine.line_index,
      };
    });

    const threshold = thresholdForCauseMass(cause.mass, strongMinScore, weakMinScore, minPairStrength);

    // Find best unclaimed effect (strict one-to-one)
    const best = scored
      .filter((s) => !claimedEffects.has(s.effectLineIndex))
      .sort((a, b) => b.strength_ce - a.strength_ce)[0];

    if (best && best.strength_ce >= threshold) {
      claimedEffects.add(best.effectLineIndex);
      const effectLine = transcript[best.effectIndex];
      const effectMass = best.effectDetection.isEffect ? best.effectDetection.mass : 0;
      const legacyStrength = classifyLegacyStrength(cause.mass);
      const linkMass = cause.mass + effectMass;
      const spanStart = Math.min(cause.index, effectLine.line_index);
      const spanEnd = Math.max(cause.index, effectLine.line_index);

      links.push({
        id: randomUUID(),
        session_id: sessionId,
        cause_text: cause.text,
        cause_type: cause.detection.cause_type,
        cause_anchor_index: cause.index,
        cause_mass: cause.mass,
        effect_text: effectLine.content,
        effect_type: best.effectDetection.isEffect ? best.effectDetection.effect_type : "none",
        effect_anchor_index: effectLine.line_index,
        effect_mass: effectMass,
        level: 1,
        members: undefined,
        strength_bridge: best.strength_ce,
        strength_internal: best.strength_ce,
        strength: best.strength_ce,
        strength_ce: best.strength_ce,
        link_mass: linkMass,
        mass_boost: 0,
        span_start_index: spanStart,
        span_end_index: spanEnd,
        center_index: Math.round((cause.index + effectLine.line_index) / 2),
        mass: linkMass,
        actor: cause.actor.id,
        intent_text: cause.text,
        intent_type: cause.detection.cause_type,
        intent_strength: legacyStrength,
        intent_anchor_index: cause.index,
        consequence_text: effectLine.content,
        consequence_type: best.effectDetection.isEffect ? best.effectDetection.effect_type : "none",
        consequence_anchor_index: effectLine.line_index,
        distance: best.distance,
        score: best.strength_ce,
        claimed: true,
        created_at_ms: Date.now(),
      });

      if (emitTraces) {
        traces.push({
          anchor_index: cause.index,
          cause_anchor_index: cause.index,
          strength: legacyStrength,
          intent_kind: cause.detection.cause_type,
          cause_kind: cause.detection.cause_type,
          cause_mass: cause.mass,
          eligible: true,
          candidates: scored.map((s) => ({
            consequence_index: transcript[s.effectIndex].line_index,
            effect_index: transcript[s.effectIndex].line_index,
            speaker: transcript[s.effectIndex].author_name,
            eligible: true,
            distance: s.distance,
            distance_score: s.distanceScore,
            lexical_score: s.lexicalScore,
            answer_boost: s.answerBoost,
            commentary_penalty: 0,
            pronoun_boost: 0,
            final_score: s.strength_ce,
            strength_ce: s.strength_ce,
            effect_mass: s.effectDetection.isEffect ? s.effectDetection.mass : 0,
          })),
          chosen_consequence_index: transcript[best.effectIndex].line_index,
          chosen_effect_index: transcript[best.effectIndex].line_index,
          chosen_score: best.strength_ce,
          chosen_strength: best.strength_ce,
          claim_reason: "mass_ordered_one_to_one",
        });
      }
    } else {
      const legacyStrength = classifyLegacyStrength(cause.mass);
      const spanStart = cause.index;
      const spanEnd = cause.index;
      links.push({
        id: randomUUID(),
        session_id: sessionId,
        cause_text: cause.text,
        cause_type: cause.detection.cause_type,
        cause_anchor_index: cause.index,
        cause_mass: cause.mass,
        effect_text: null,
        effect_type: "none",
        effect_anchor_index: null,
        effect_mass: 0,
        level: 1,
        members: undefined,
        strength_bridge: 0,
        strength_internal: 0,
        strength: null,
        strength_ce: null,
        link_mass: cause.mass,
        mass_boost: 0,
        span_start_index: spanStart,
        span_end_index: spanEnd,
        center_index: cause.index,
        mass: cause.mass,
        actor: cause.actor.id,
        intent_text: cause.text,
        intent_type: cause.detection.cause_type,
        intent_strength: legacyStrength,
        intent_anchor_index: cause.index,
        consequence_text: null,
        consequence_type: "none",
        consequence_anchor_index: null,
        distance: null,
        score: null,
        claimed: false,
        created_at_ms: Date.now(),
      });

      if (emitTraces) {
        traces.push({
          anchor_index: cause.index,
          cause_anchor_index: cause.index,
          strength: legacyStrength,
          intent_kind: cause.detection.cause_type,
          cause_kind: cause.detection.cause_type,
          cause_mass: cause.mass,
          eligible: true,
          candidates: scored.map((s) => ({
            consequence_index: transcript[s.effectIndex].line_index,
            effect_index: transcript[s.effectIndex].line_index,
            speaker: transcript[s.effectIndex].author_name,
            eligible: true,
            distance: s.distance,
            distance_score: s.distanceScore,
            lexical_score: s.lexicalScore,
            answer_boost: s.answerBoost,
            commentary_penalty: 0,
            pronoun_boost: 0,
            final_score: s.strength_ce,
            strength_ce: s.strength_ce,
            effect_mass: s.effectDetection.isEffect ? s.effectDetection.mass : 0,
          })),
          claim_reason: "score_threshold",
        });
      }
    }
  }

  boostLinkMasses(
    links,
    hillTau,
    hillSteepness,
    betaLexLL,
    linkWindow,
    linkBoostDamping,
    requireClaimedNeighbors,
  );

  const unclaimedEffects = effects.filter((e) => !claimedEffects.has(e.anchor_index));

  return {
    links,
    traces: emitTraces ? traces : undefined,
    effects,
    unclaimedEffects,
  };
}
