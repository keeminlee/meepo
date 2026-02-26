import { createHash } from "node:crypto";
import type { TranscriptEntry } from "../ledger/transcripts.js";
import type { ActorLike } from "./actorFeatures.js";
import type { EligibilityMask } from "./types.js";
import { CAUSAL_KERNEL_VERSION, extractCausalLinksKernel, type KernelInput } from "./extractCausalLinksKernel.js";
import { linkLinksKernel, type LinkLinkParams } from "./linkLinksKernel.js";
import { propagateInternalStrength } from "./propagateInternalStrength.js";
import { absorbSingletons } from "./absorbSingletons.js";
import { isLineEligible } from "./eligibilityMask.js";
import { isDmSpeaker } from "../ledger/scaffoldSpeaker.js";
import type { SingletonNode } from "./cycleTypes.js";
import type { CausalLink } from "./types.js";
import type { RoundPhaseState, RoundMetrics } from "./hierarchyTypes.js";
import type { LeverParams } from "./evidenceStrength.js";

/** When enabled: if a link phase produces 0 new composites, run repeated anneal until mass stabilizes. */
export type ConvergenceParams = {
  enabled: boolean;
  /** Stop anneal loop when max |mass_new - mass_prev| across nodes < this. */
  massDeltaEpsilon: number;
  /** Cap on anneal iterations per convergence run. */
  maxAnnealIterations: number;
};

export type HierarchyParams = {
  kernel: {
    kLocal: number;
    hillTau: number;
    hillSteepness: number;
    betaLex: number;
    strongMinScore: number;
    weakMinScore: number;
    minPairStrength?: number;
    maxL1Span?: number;
    ambientMassBoost?: boolean;
  };
  anneal: {
    /** Absorb singleton candidates within radius = radiusBase + radiusPerMass * linkMass. */
    radiusBase: number;
    radiusPerMass: number;
    /** Per-link capacity cap = floor(capBase + capPerMass * linkMass). */
    capBase: number;
    capPerMass: number;
    /** Minimum singleton→link absorb strength. */
    minCtxStrength: number;
    /** Optional mass-aware absorb threshold. */
    ctxThresholdBase?: number;
    ctxThresholdPerLogMass?: number;
    hillTau: number;
    hillSteepness: number;
    betaLex: number;
  };
  linkLinks: {
    kLocalLinks: number;
    hillTau: number;
    hillSteepness: number;
    betaLex: number;
    minBridge: number;
    maxForwardLines: number;
  };
  maxLevel: number;
  /** Max link+anneal rounds (round 1 = kernel; rounds 2..maxRounds = linkLinks). Default from maxLevel. */
  maxRounds?: number;
  /** If set, when a link round produces 0 new composites, run anneal until mass delta < epsilon (or max iters). */
  convergence?: ConvergenceParams;
  /** Two-lever params (evidence→strength). When set, kernel/linkLinks use E^γ and T0+η·g(m). */
  levers?: LeverParams;
};

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? 0;
}

function stats(values: number[]): { min: number; p50: number; p90: number; max: number } {
  if (values.length === 0) return { min: 0, p50: 0, p90: 0, max: 0 };
  return {
    min: Math.min(...values),
    p50: percentile(values, 50),
    p90: percentile(values, 90),
    max: Math.max(...values),
  };
}

function getStrengthBridge(link: CausalLink): number {
  if (typeof link.strength_bridge === "number") return link.strength_bridge;
  if (typeof link.strength_ce === "number") return link.strength_ce;
  if (typeof link.score === "number") return link.score;
  return 0;
}

function getStrengthInternal(link: CausalLink): number {
  if (typeof link.strength_internal === "number") return link.strength_internal;
  return getStrengthBridge(link);
}

function getMass(link: CausalLink): number {
  return link.mass ?? link.link_mass ?? link.mass_base ?? link.cause_mass ?? 0;
}

function buildAllEligibleL0Singletons(input: {
  sessionId: string;
  transcript: TranscriptEntry[];
  eligibilityMask: EligibilityMask;
  dmSpeaker: Set<string>;
  claimedAnchorIndices: Set<number>;
}): { singletonCauses: SingletonNode[]; singletonEffects: SingletonNode[] } {
  const singletonCauses: SingletonNode[] = [];
  const singletonEffects: SingletonNode[] = [];
  for (let i = 0; i < input.transcript.length; i++) {
    const line = input.transcript[i];
    const idx = line.line_index;
    if (!isLineEligible(input.eligibilityMask, idx)) continue;
    if (input.claimedAnchorIndices.has(idx)) continue;
    const singleton: SingletonNode = {
      id: `S:l0:${input.sessionId}:${idx}`,
      kind: isDmSpeaker(line.author_name, input.dmSpeaker) ? "effect" : "cause",
      anchor_index: idx,
      text: line.content,
      mass: 1,
      type: "stray_l0",
    };
    if (singleton.kind === "cause") singletonCauses.push(singleton);
    else singletonEffects.push(singleton);
  }
  return { singletonCauses, singletonEffects };
}

export async function runRounds(input: {
  sessionId: string;
  transcript: TranscriptEntry[];
  eligibilityMask: EligibilityMask;
  actors: ActorLike[];
  dmSpeaker: Set<string>;
  params: HierarchyParams;
}): Promise<{
  allRounds: RoundPhaseState[];
  finalNodes: CausalLink[];
  provenance: { kernel_version: string; params_json: string; param_hash: string };
}> {
  const paramsJson = JSON.stringify(input.params);
  const paramHash = createHash("sha256").update(paramsJson).digest("hex").slice(0, 12);

  const allRounds: RoundPhaseState[] = [];
  let cumulativeAbsorptions = 0;

  // ROUND 1: Kernel (L0 -> L1)
  const kernelInput: KernelInput = {
    sessionId: input.sessionId,
    transcript: input.transcript,
    eligibilityMask: input.eligibilityMask,
    actors: input.actors,
    dmSpeaker: input.dmSpeaker,
    kLocal: input.params.kernel.kLocal,
    strongMinScore: input.params.kernel.strongMinScore,
    weakMinScore: input.params.kernel.weakMinScore,
    minPairStrength: input.params.kernel.minPairStrength,
    maxL1Span: input.params.kernel.maxL1Span,
    ambientMassBoost: input.params.kernel.ambientMassBoost ?? false,
    hillTau: input.params.kernel.hillTau,
    hillSteepness: input.params.kernel.hillSteepness,
    betaLex: input.params.kernel.betaLex,
    levers: input.params.levers,
  };

  const kernelOutput = extractCausalLinksKernel(kernelInput, false);
  const round1LinkNodes = kernelOutput.links;

  // Round 1 LINK metrics
  const pairsFormed = round1LinkNodes.filter((l) => l.claimed).length;
  const effectsTotal = kernelOutput.effects?.length ?? 0;
  const effectsUnclaimed = kernelOutput.unclaimedEffects?.length ?? 0;
  const effectsUniqueClaimed = Math.max(0, effectsTotal - effectsUnclaimed);

  const round1LinkMetrics: RoundMetrics = {
    round: 1,
    phase: "link",
    label: "link",
    timestamp_ms: Date.now(),
    counts: {
      nodes_total: round1LinkNodes.length,
      pairs_formed: pairsFormed,
      effects_total: effectsTotal,
      effects_unique_claimed: effectsUniqueClaimed,
      effects_unclaimed: effectsUnclaimed,
    },
    stats: {
      strength_bridge: stats(round1LinkNodes.map(getStrengthBridge)),
      strength_internal: stats(round1LinkNodes.map(getStrengthInternal)),
      mass: stats(round1LinkNodes.map(getMass)),
    },
  };

  allRounds.push({
    round: 1,
    phase: "link",
    nodes: round1LinkNodes,
    neighborEdges: [],
    metrics: round1LinkMetrics,
  });

  const claimedAnchorIndices = new Set<number>();
  const round1AbsorbableLinks = round1LinkNodes.filter((n) => n.claimed);
  for (const link of round1AbsorbableLinks) {
    const cause = link.cause_anchor_index ?? link.intent_anchor_index;
    const effect = link.effect_anchor_index ?? link.consequence_anchor_index;
    if (typeof cause === "number") claimedAnchorIndices.add(cause);
    if (typeof effect === "number") claimedAnchorIndices.add(effect);
  }
  const allEligibleL0 = buildAllEligibleL0Singletons({
    sessionId: input.sessionId,
    transcript: input.transcript,
    eligibilityMask: input.eligibilityMask,
    dmSpeaker: input.dmSpeaker,
    claimedAnchorIndices,
  });
  let singletonCauses: SingletonNode[] = allEligibleL0.singletonCauses;
  let singletonEffects: SingletonNode[] = allEligibleL0.singletonEffects;

  // Round 1 ANNEAL (absorption): absorb singleton/stray L0 lines into current links.
  const anneal1 = absorbSingletons({
    links: round1AbsorbableLinks,
    singletonCauses,
    singletonEffects,
    radiusBase: input.params.anneal.radiusBase,
    radiusPerMass: input.params.anneal.radiusPerMass,
    capBase: input.params.anneal.capBase,
    capPerMass: input.params.anneal.capPerMass,
    minCtxStrength: input.params.anneal.minCtxStrength,
    ctxThresholdBase: input.params.anneal.ctxThresholdBase,
    ctxThresholdPerLogMass: input.params.anneal.ctxThresholdPerLogMass,
    hillTau: input.params.anneal.hillTau,
    hillSteepness: input.params.anneal.hillSteepness,
    betaLex: input.params.anneal.betaLex,
    levers: input.params.levers,
  });
  singletonCauses = anneal1.singletonCauses;
  singletonEffects = anneal1.singletonEffects;

  const round1AnnealMetrics: RoundMetrics = {
    round: 1,
    phase: "anneal",
    label: "absorption",
    timestamp_ms: Date.now(),
    counts: {
      nodes: anneal1.links.length,
      absorptions_this_round: anneal1.contextEdges.length,
      absorptions_causes: anneal1.contextEdges.filter((e) => e.singleton_kind === "cause").length,
      absorptions_effects: anneal1.contextEdges.filter((e) => e.singleton_kind === "effect").length,
      singleton_causes_remaining: singletonCauses.length,
      singleton_effects_remaining: singletonEffects.length,
    },
    stats: {
      strength_internal: stats(anneal1.links.map(getStrengthInternal)),
      mass: stats(anneal1.links.map(getMass)),
    },
  };

  allRounds.push({
    round: 1,
    phase: "anneal",
    nodes: anneal1.links,
    neighborEdges: [],
    metrics: round1AnnealMetrics,
  });
  cumulativeAbsorptions += anneal1.contextEdges.length;
  round1AnnealMetrics.counts.absorptions_cumulative = cumulativeAbsorptions;

  let prevLevelMap = new Map(anneal1.links.map((node) => [node.id, node]));
  let currentRoundNodes = anneal1.links;

  const maxRounds = input.params.maxRounds ?? input.params.maxLevel ?? 3;

  // Rounds 2..maxRounds: Link-Links then anneal(absorb singleton context)
  for (let r = 2; r <= maxRounds; r++) {
    const linkOut = linkLinksKernel({
      sessionId: input.sessionId,
      nodes: currentRoundNodes,
      params: {
        kLocalLinks: input.params.linkLinks.kLocalLinks,
        hillTau: input.params.linkLinks.hillTau,
        hillSteepness: input.params.linkLinks.hillSteepness,
        betaLex: input.params.linkLinks.betaLex,
        minBridge: input.params.linkLinks.minBridge,
        maxForwardLines: input.params.linkLinks.maxForwardLines,
        levers: input.params.levers,
      },
    });

    const linkNodes = [...linkOut.composites, ...linkOut.unpaired];

    const linkMetrics: RoundMetrics = {
      round: r,
      phase: "link",
      label: "link",
      timestamp_ms: Date.now(),
      counts: {
        nodes_total: linkNodes.length,
        pairs_formed: linkOut.composites.length,
        unpaired_total: linkOut.unpaired.length,
      },
      stats: {
        strength_bridge: stats(linkNodes.map(getStrengthBridge)),
        strength_internal: stats(linkNodes.map(getStrengthInternal)),
        mass: stats(linkNodes.map(getMass)),
      },
    };

    allRounds.push({
      round: r,
      phase: "link",
      nodes: linkNodes,
      neighborEdges: [],
      metrics: linkMetrics,
      candidates: linkOut.candidates,
    });

    const annealOut = absorbSingletons({
      links: linkNodes,
      singletonCauses,
      singletonEffects,
      radiusBase: input.params.anneal.radiusBase,
      radiusPerMass: input.params.anneal.radiusPerMass,
      capBase: input.params.anneal.capBase,
      capPerMass: input.params.anneal.capPerMass,
      minCtxStrength: input.params.anneal.minCtxStrength,
      ctxThresholdBase: input.params.anneal.ctxThresholdBase,
      ctxThresholdPerLogMass: input.params.anneal.ctxThresholdPerLogMass,
      hillTau: input.params.anneal.hillTau,
      hillSteepness: input.params.anneal.hillSteepness,
      betaLex: input.params.anneal.betaLex,
      levers: input.params.levers,
    });
    propagateInternalStrength(annealOut.links, prevLevelMap);
    singletonCauses = annealOut.singletonCauses;
    singletonEffects = annealOut.singletonEffects;
    const annealMetrics: RoundMetrics = {
      round: r,
      phase: "anneal",
      label: "absorption",
      timestamp_ms: Date.now(),
      counts: {
        nodes: annealOut.links.length,
        absorptions_this_round: annealOut.contextEdges.length,
        absorptions_causes: annealOut.contextEdges.filter((e) => e.singleton_kind === "cause").length,
        absorptions_effects: annealOut.contextEdges.filter((e) => e.singleton_kind === "effect").length,
        singleton_causes_remaining: singletonCauses.length,
        singleton_effects_remaining: singletonEffects.length,
      },
      stats: {
        strength_internal: stats(annealOut.links.map(getStrengthInternal)),
        mass: stats(annealOut.links.map(getMass)),
      },
    };
    allRounds.push({
      round: r,
      phase: "anneal",
      nodes: annealOut.links,
      neighborEdges: [],
      metrics: annealMetrics,
    });
    cumulativeAbsorptions += annealOut.contextEdges.length;
    annealMetrics.counts.absorptions_cumulative = cumulativeAbsorptions;
    prevLevelMap = new Map(annealOut.links.map((node) => [node.id, node]));
    currentRoundNodes = annealOut.links;

    const convergence = input.params.convergence;
    if (
      convergence?.enabled &&
      linkOut.composites.length === 0 &&
      annealOut.contextEdges.length === 0
    ) {
      break;
    }
  }

  return {
    allRounds,
    finalNodes: currentRoundNodes,
    provenance: {
      kernel_version: CAUSAL_KERNEL_VERSION,
      params_json: paramsJson,
      param_hash: paramHash,
    },
  };
}
