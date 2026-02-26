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
import {
  evidenceFromDistanceLexical,
  evidenceToStrength,
  localityToTau,
  type LeverParams,
} from "./evidenceStrength.js";
import {
  buildLexicalCorpusStats,
  lexicalSignals,
  scoreTokenOverlapSimple,
} from "./lexicalSignals.js";

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
  /** Max cause–effect distance for L1 links (avoids huge spans when eligibility masks out middle). */
  maxL1Span?: number;
  /** When set, use evidence→strength (E^γ) instead of distance*(1+betaLex*lexical). */
  levers?: LeverParams;
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
/** Max cause–effect distance for L1 links; avoids huge spans when eligibility masks out the middle. */
const MAX_L1_SPAN_DEFAULT = 18;
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
  return scoreTokenOverlapSimple(text1, text2);
}

function classifyLegacyStrength(mass: number): "strong" | "weak" {
  return mass >= 0.7 ? "strong" : "weak";
}

function thresholdForCause(
  cause: { detectionMass: number },
  strongMinScore: number,
  weakMinScore: number,
  minPairStrength?: number,
): number {
  const byStrength = classifyLegacyStrength(cause.detectionMass) === "strong" ? strongMinScore : weakMinScore;
  return typeof minPairStrength === "number" ? Math.max(minPairStrength, byStrength) : byStrength;
}

/** Single mass for every L1 link (all leaves); no inflation by cause/effect type or link formation. */
const LEAF_MASS = 1;

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
  levers?: LeverParams,
  corpusStats?: ReturnType<typeof buildLexicalCorpusStats>,
): Omit<ScoredCandidate, "effectIndex" | "effectLineIndex"> {
  const distanceScore = distanceScoreHill(distance, hillTau, hillSteepness);
  const { lexicalScore, keywordOverlap } = levers
    ? lexicalSignals(causeText, effectText, corpusStats)
    : { lexicalScore: scoreTokenOverlap(causeText, effectText), keywordOverlap: 0 };
  const answerBoost = isYesNoAnswerLike(effectText) ? 0.15 : 0;

  let strength_ce: number;
  if (levers) {
    // Lever regime: extra lexical boost when overlap includes cause/effect trigger keywords.
    const keywordBoost = keywordOverlap * (levers.keywordLexBonus ?? 0.25);
    const lexicalAugmented = Math.min(1, lexicalScore * (1 + keywordBoost));
    const E = evidenceFromDistanceLexical(distanceScore, lexicalAugmented, answerBoost);
    strength_ce = evidenceToStrength(E, levers.coupling, levers.strengthScale ?? 2);
  } else {
    strength_ce = distanceScore * (1 + lexicalScore * betaLex) + answerBoost;
  }

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
  levers?: LeverParams,
): void {
  const centers = links.map(getCenterIndex);
  const texts = links.map(getLinkText);
  const baseMass = links.map((l) => l.link_mass ?? l.mass ?? l.cause_mass ?? 0);
  const corpusStats = levers ? buildLexicalCorpusStats(texts) : undefined;

  for (let i = 0; i < links.length; i++) {
    let bonus = 0;
    for (let j = 0; j < links.length; j++) {
      if (i === j) continue;
      if (requireClaimedNeighbors && !links[j].claimed) continue;

      const centerDistance = Math.abs(centers[i] - centers[j]);
      if (centerDistance > linkWindow) continue;

      const distEvidence = distanceScoreHill(centerDistance, hillTau, hillSteepness);
      const { lexicalScore, keywordOverlap } = levers
        ? lexicalSignals(texts[i], texts[j], corpusStats)
        : { lexicalScore: scoreTokenOverlap(texts[i], texts[j]), keywordOverlap: 0 };
      const strengthLL = levers
        ? evidenceToStrength(
            evidenceFromDistanceLexical(
              distEvidence,
              Math.min(1, lexicalScore * (1 + keywordOverlap * (levers.keywordLexBonus ?? 0.25))),
            ),
            levers.coupling,
            levers.strengthScale ?? 2,
          )
        : distEvidence * (1 + betaLexLL * lexicalScore);
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
    hillTau: hillTauParam = HILL_TAU_DEFAULT,
    hillSteepness = HILL_STEEPNESS_DEFAULT,
    betaLex = BETA_LEX_DEFAULT,
    betaLexLL = BETA_LEX_LL_DEFAULT,
    linkWindow = LINK_WINDOW_DEFAULT,
    linkBoostDamping = LINK_BOOST_DAMPING_DEFAULT,
    requireClaimedNeighbors = true,
    ambientMassBoost = false,
    maxL1Span = MAX_L1_SPAN_DEFAULT,
    levers,
  } = input;

  const hillTau = levers ? localityToTau(levers.locality) : hillTauParam;
  const corpusStats = levers ? buildLexicalCorpusStats(transcript.map((t) => t.content)) : undefined;

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
      mass: LEAF_MASS,
    });
  }

  for (let i = 0; i < transcript.length; i++) {
    const line = transcript[i];
    if (!isLineEligible(eligibilityMask, i)) continue;
    if (!isDmSpeaker(line.author_name, dmSpeaker)) continue;
    const detection = detectEffect(line.content);
    if (!detection.isEffect) continue;

    effectPool.push({
      index: i,
      anchor_index: line.line_index,
      text: line.content,
      effect_type: detection.effect_type,
      mass: LEAF_MASS,
      detection,
    });

    effects.push({
      anchor_index: line.line_index,
      text: line.content,
      effect_type: detection.effect_type,
      mass: LEAF_MASS,
    });
  }

  const claimedEffects = new Set<number>();
  const claimedCauses = new Set<number>();

  // Index lines by speaker (eligible only) for "next k DM" / "prev k PC" candidate windows.
  const dmIndices: number[] = [];
  const pcIndices: number[] = [];
  for (let i = 0; i < transcript.length; i++) {
    if (!isLineEligible(eligibilityMask, i)) continue;
    const line = transcript[i];
    if (isDmSpeaker(line.author_name, dmSpeaker)) dmIndices.push(i);
    else pcIndices.push(i);
  }

  type EffectEntry = (typeof effectPool)[number];
  const effectByAnchor = new Map<number, EffectEntry>(
    effectPool.map((e) => [e.anchor_index, e])
  );
  // Ensure every DM line has an effect entry (for candidate scoring); use synthetic if not in pool.
  for (const i of dmIndices) {
    const line = transcript[i];
    const anchor = line.line_index;
    if (effectByAnchor.has(anchor)) continue;
    const detection = detectEffect(line.content);
    effectByAnchor.set(anchor, {
      index: i,
      anchor_index: anchor,
      text: line.content,
      effect_type: (detection.effect_type ?? "other") as string,
      mass: LEAF_MASS,
      detection,
    });
  }

  type CauseEntry = (typeof causes)[number];
  const causeByIndex = new Map<number, CauseEntry>(causes.map((c) => [c.index, c]));
  // Ensure every PC line has a cause entry for backward candidate scoring.
  for (const i of pcIndices) {
    if (causeByIndex.has(i)) continue;
    const line = transcript[i];
    const actor = matchPcSpeaker(line.author_name, actors);
    if (!actor) continue;
    const detection = detectCause(line.content);
    causeByIndex.set(i, {
      index: i,
      actor,
      text: line.content,
      detection,
      detectionMass: detection.mass,
      mass: LEAF_MASS,
    });
  }

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

  // Candidate selection: kLocal applies to correct-speaker lines only. We always take up to kLocal candidates when transcript bounds allow.
  // Forward: for each cause (PC), effect candidates = the next kLocal DM lines (strictly after cause).
  // Backward: for each effect (DM), cause candidates = the previous kLocal PC lines (strictly before effect).
  for (const cause of causes) {
    const nextKdm = dmIndices.filter((i) => i > cause.index).slice(0, kLocal);
    for (const j of nextKdm) {
      const effect = effectByAnchor.get(transcript[j].line_index)!;
      const distance = Math.max(1, j - cause.index);
      const base = scoreCandidate(
        cause.text,
        effect.text,
        distance,
        hillTau,
        hillSteepness,
        betaLex,
        effect.detection,
        levers,
        corpusStats,
      );
      const threshold = thresholdForCause(cause, strongMinScore, weakMinScore, minPairStrength);
      if (base.strength_ce < threshold) continue;
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

  for (const effectIdx of dmIndices) {
    const effect = effectByAnchor.get(transcript[effectIdx].line_index)!;
    const prevKpc = pcIndices.filter((i) => i < effectIdx).slice(-kLocal);
    for (const j of prevKpc) {
      const cause = causeByIndex.get(j)!;
      const distance = Math.max(1, effectIdx - j);
      const rollPromptBoost = effect.detection.effect_type === "roll" ? 0.1 : 0;
      const base = scoreCandidate(
        cause.text,
        effect.text,
        distance,
        hillTau,
        hillSteepness,
        betaLex,
        effect.detection,
        levers,
        corpusStats,
      );
      const strengthCe = base.strength_ce + rollPromptBoost;
      const threshold = thresholdForCause(cause, strongMinScore, weakMinScore, minPairStrength);
      if (strengthCe < threshold) continue;
      addOrUpdateEdge({
        causeIndex: cause.index,
        effectIndex: effect.anchor_index,
        direction: "backward",
        distance,
        distanceScore: base.distanceScore,
        lexicalScore: base.lexicalScore,
        answerBoost: base.answerBoost + rollPromptBoost,
        strength_ce: strengthCe,
        effectDetection: effect.detection,
      });
    }
  }

  let edges = Array.from(edgeByPair.values());
  edges = edges.filter((e) => e.distance <= maxL1Span);
  edges.sort((a, b) => {
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
        mass_base: LEAF_MASS,
        link_mass: LEAF_MASS,
        mass_boost: 0,
        span_start_index: spanStart,
        span_end_index: spanEnd,
        center_index: (cause.index + effect.anchor_index) / 2,
        mass: LEAF_MASS,
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
      mass_base: LEAF_MASS,
      link_mass: LEAF_MASS,
      mass_boost: 0,
      span_start_index: spanStart,
      span_end_index: spanEnd,
      center_index: cause.index,
      mass: LEAF_MASS,
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
      levers,
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
