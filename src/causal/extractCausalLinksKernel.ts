/**
 * extractCausalLinksKernel.ts: Chunkless causal link extraction (MVP)
 * 
 * Deterministic cause → effect pairing with local scoring.
 * Runs line-by-line over eligible lines (gated by EligibilityMask).
 * No chunk propagation into scoring; chunks only used for eligibility.
 * 
 * Core logic:
 *   Pass 1: Detect all causes in eligible PC lines with mass
 *   Pass 2: Build forward + backward local PC↔DM candidates
 *   Pass 3: Global edge-driven one-to-one allocation (exclusive endpoints)
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

export const CAUSAL_KERNEL_VERSION = "ce-mass-v3";

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
  ambientMassBoost?: boolean;
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

interface EdgeCandidate {
  causeIndex: number;
  effectIndex: number;
  direction: "forward" | "backward";
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

function computeLeafMass(text: string, speaker: "pc" | "dm"): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const base = speaker === "pc" ? 0.22 : 0.18;
  const lenBoost = Math.min(0.18, words * 0.01);
  return Number((base + lenBoost).toFixed(4));
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

function getLinkText(link: CausalLink): string {
  const causeText = link.cause_text ?? link.intent_text;
  const effectText = link.effect_text ?? link.consequence_text ?? "";
  return `${causeText} ${effectText}`.trim();
}

function getCenterIndex(link: CausalLink): number {
  const cause = link.cause_anchor_index ?? link.intent_anchor_index;
  const effect = link.effect_anchor_index ?? link.consequence_anchor_index;
  if (typeof effect === "number") return (cause + effect) / 2;
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
    ambientMassBoost = false,
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
    detectionMass: number;
    mass: number;
  }> = [];

  const effectPool: Array<{
    index: number;
    anchor_index: number;
    text: string;
    effect_type: string;
    mass: number;
    detection: EffectDetection;
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
      detectionMass: detection.mass,
      mass: computeLeafMass(line.content, "pc"),
    });
  }

  for (let i = 0; i < transcript.length; i++) {
    const line = transcript[i];
    if (!isLineEligible(eligibilityMask, i)) continue;
    if (!isDmSpeaker(line.author_name, dmSpeaker)) continue;
    const detection = detectEffect(line.content);
    if (!detection.isEffect) continue;

    const mass = computeLeafMass(line.content, "dm");

    effectPool.push({
      index: i,
      anchor_index: line.line_index,
      text: line.content,
      effect_type: detection.effect_type,
      mass,
      detection,
    });

    effects.push({
      anchor_index: line.line_index,
      text: line.content,
      effect_type: detection.effect_type,
      mass,
    });
  }

  const claimedEffects = new Set<number>();
  const claimedCauses = new Set<number>();

  const effectByAnchor = new Map(effectPool.map((effect) => [effect.anchor_index, effect]));

  const edgeByPair = new Map<string, EdgeCandidate>();
  const addOrUpdateEdge = (edge: EdgeCandidate) => {
    const key = `${edge.causeIndex}::${edge.effectIndex}`;
    const existing = edgeByPair.get(key);
    if (!existing) {
      edgeByPair.set(key, edge);
      return;
    }
    if (edge.strength_ce > existing.strength_ce) {
      edgeByPair.set(key, edge);
      return;
    }
    if (edge.strength_ce === existing.strength_ce && edge.distance < existing.distance) {
      edgeByPair.set(key, edge);
      return;
    }
    if (
      edge.strength_ce === existing.strength_ce &&
      edge.distance === existing.distance &&
      edge.direction === "forward" &&
      existing.direction === "backward"
    ) {
      edgeByPair.set(key, edge);
    }
  };

  for (const cause of causes) {
    const forwardEffects = effectPool
      .filter((effect) => effect.anchor_index > cause.index)
      .sort((a, b) => a.anchor_index - b.anchor_index)
      .slice(0, kLocal);

    for (const effect of forwardEffects) {
      const distance = Math.max(1, effect.anchor_index - cause.index);
      const base = scoreCandidate(
        cause.text,
        effect.text,
        distance,
        hillTau,
        hillSteepness,
        betaLex,
        effect.detection,
      );

      addOrUpdateEdge({
        causeIndex: cause.index,
        effectIndex: effect.anchor_index,
        direction: "forward",
        distance,
        distanceScore: base.distanceScore,
        lexicalScore: base.lexicalScore,
        answerBoost: base.answerBoost,
        strength_ce: base.strength_ce,
        effectDetection: effect.detection,
      });
    }
  }

  for (const effect of effectPool) {
    const backwardCauses = causes
      .filter((cause) => cause.index < effect.anchor_index)
      .sort((a, b) => b.index - a.index)
      .slice(0, kLocal);

    for (const cause of backwardCauses) {
      const distance = Math.max(1, effect.anchor_index - cause.index);
      const base = scoreCandidate(
        cause.text,
        effect.text,
        distance,
        hillTau,
        hillSteepness,
        betaLex,
        effect.detection,
      );

      const rollPromptBoost = effect.detection.effect_type === "roll" ? 0.1 : 0;
      addOrUpdateEdge({
        causeIndex: cause.index,
        effectIndex: effect.anchor_index,
        direction: "backward",
        distance,
        distanceScore: base.distanceScore,
        lexicalScore: base.lexicalScore,
        answerBoost: base.answerBoost + rollPromptBoost,
        strength_ce: base.strength_ce + rollPromptBoost,
        effectDetection: effect.detection,
      });
    }
  }

  const edges = Array.from(edgeByPair.values()).sort((a, b) => {
    if (b.strength_ce !== a.strength_ce) return b.strength_ce - a.strength_ce;
    if (a.distance !== b.distance) return a.distance - b.distance;
    if (a.causeIndex !== b.causeIndex) return a.causeIndex - b.causeIndex;
    if (a.effectIndex !== b.effectIndex) return a.effectIndex - b.effectIndex;
    if (a.direction !== b.direction) return a.direction === "forward" ? -1 : 1;
    return 0;
  });

  const chosenByCause = new Map<number, EdgeCandidate>();
  for (const edge of edges) {
    if (claimedCauses.has(edge.causeIndex)) continue;
    if (claimedEffects.has(edge.effectIndex)) continue;
    claimedCauses.add(edge.causeIndex);
    claimedEffects.add(edge.effectIndex);
    chosenByCause.set(edge.causeIndex, edge);
  }

  const candidatesByCause = new Map<number, EdgeCandidate[]>();
  for (const edge of edges) {
    const arr = candidatesByCause.get(edge.causeIndex) ?? [];
    arr.push(edge);
    candidatesByCause.set(edge.causeIndex, arr);
  }

  const sortedCauses = [...causes].sort((a, b) => a.index - b.index);
  for (const cause of sortedCauses) {
    const chosen = chosenByCause.get(cause.index);
    const legacyStrength = classifyLegacyStrength(cause.detectionMass);

    if (chosen) {
      const effect = effectByAnchor.get(chosen.effectIndex);
      if (!effect) continue;

      const strengthBridge = chosen.strength_ce;
      const strengthInternal = strengthBridge;
      const massBase = cause.mass + effect.mass + strengthInternal;
      const spanStart = Math.min(cause.index, effect.anchor_index);
      const spanEnd = Math.max(cause.index, effect.anchor_index);

      links.push({
        id: randomUUID(),
        session_id: sessionId,
        node_kind: "link",
        cause_text: cause.text,
        cause_type: cause.detection.cause_type,
        cause_anchor_index: cause.index,
        cause_mass: cause.mass,
        effect_text: effect.text,
        effect_type: effect.effect_type as EffectDetection["effect_type"],
        effect_anchor_index: effect.anchor_index,
        effect_mass: effect.mass,
        level: 1,
        members: undefined,
        strength_bridge: strengthBridge,
        strength_internal: strengthInternal,
        strength: strengthInternal,
        strength_ce: strengthBridge,
        mass_base: massBase,
        link_mass: massBase,
        mass_boost: 0,
        span_start_index: spanStart,
        span_end_index: spanEnd,
        center_index: (cause.index + effect.anchor_index) / 2,
        mass: massBase,
        actor: cause.actor.id,
        intent_text: cause.text,
        intent_type: cause.detection.cause_type,
        intent_strength: legacyStrength,
        intent_anchor_index: cause.index,
        consequence_text: effect.text,
        consequence_type: effect.effect_type as CausalLink["consequence_type"],
        consequence_anchor_index: effect.anchor_index,
        distance: chosen.distance,
        score: strengthBridge,
        claimed: true,
        created_at_ms: Date.now(),
      });

      if (emitTraces) {
        const scored = candidatesByCause.get(cause.index) ?? [];
        traces.push({
          anchor_index: cause.index,
          cause_anchor_index: cause.index,
          strength: legacyStrength,
          intent_kind: cause.detection.cause_type,
          cause_kind: cause.detection.cause_type,
          cause_mass: cause.mass,
          eligible: true,
          candidates: scored.map((s) => ({
            consequence_index: s.effectIndex,
            effect_index: s.effectIndex,
            speaker: "dm",
            eligible: true,
            distance: s.distance,
            distance_score: s.distanceScore,
            lexical_score: s.lexicalScore,
            answer_boost: s.answerBoost,
            commentary_penalty: 0,
            pronoun_boost: 0,
            final_score: s.strength_ce,
            strength_ce: s.strength_ce,
            effect_mass: effectByAnchor.get(s.effectIndex)?.mass ?? 0,
          })),
          chosen_consequence_index: chosen.effectIndex,
          chosen_effect_index: chosen.effectIndex,
          chosen_score: chosen.strength_ce,
          chosen_strength: chosen.strength_ce,
          claim_reason: "edge_greedy_one_to_one",
        });
      }

      continue;
    }

    const massBase = cause.mass;
    const spanStart = cause.index;
    const spanEnd = cause.index;
    links.push({
      id: randomUUID(),
      session_id: sessionId,
      node_kind: "singleton",
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
      strength: 0,
      strength_ce: null,
      mass_base: massBase,
      link_mass: massBase,
      mass_boost: 0,
      span_start_index: spanStart,
      span_end_index: spanEnd,
      center_index: cause.index,
      mass: massBase,
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
      const scored = candidatesByCause.get(cause.index) ?? [];
      traces.push({
        anchor_index: cause.index,
        cause_anchor_index: cause.index,
        strength: legacyStrength,
        intent_kind: cause.detection.cause_type,
        cause_kind: cause.detection.cause_type,
        cause_mass: cause.mass,
        eligible: true,
        candidates: scored.map((s) => ({
          consequence_index: s.effectIndex,
          effect_index: s.effectIndex,
          speaker: "dm",
          eligible: true,
          distance: s.distance,
          distance_score: s.distanceScore,
          lexical_score: s.lexicalScore,
          answer_boost: s.answerBoost,
          commentary_penalty: 0,
          pronoun_boost: 0,
          final_score: s.strength_ce,
          strength_ce: s.strength_ce,
          effect_mass: effectByAnchor.get(s.effectIndex)?.mass ?? 0,
        })),
        claim_reason: scored.length > 0 ? "mass_ordered_one_to_one" : "no_candidate",
      });
    }
  }

  if (ambientMassBoost) {
    boostLinkMasses(
      links,
      hillTau,
      hillSteepness,
      betaLexLL,
      linkWindow,
      linkBoostDamping,
      requireClaimedNeighbors,
    );
  }

  const unclaimedEffects = effects.filter((e) => !claimedEffects.has(e.anchor_index));

  return {
    links,
    traces: emitTraces ? traces : undefined,
    effects,
    unclaimedEffects,
  };
}
