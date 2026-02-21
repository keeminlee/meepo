import { createHash } from "node:crypto";
import type { TranscriptEntry } from "../ledger/transcripts.js";
import type { ActorLike } from "./actorFeatures.js";
import type { EligibilityMask } from "./types.js";
import { CAUSAL_KERNEL_VERSION, extractCausalLinksKernel, type KernelInput } from "./extractCausalLinksKernel.js";
import { annealLinks } from "./annealLinks.js";
import { linkLinksKernel, type LinkLinkParams } from "./linkLinksKernel.js";
import { propagateInternalStrength } from "./propagateInternalStrength.js";
import type { CausalLink } from "./types.js";
import type { RoundPhaseState, RoundMetrics } from "./hierarchyTypes.js";

export type HierarchyParams = {
  kernel: {
    kLocal: number;
    hillTau: number;
    hillSteepness: number;
    betaLex: number;
    strongMinScore: number;
    weakMinScore: number;
  };
  anneal: {
    windowLinks: number;
    hillTau: number;
    hillSteepness: number;
    betaLex: number;
    lambda: number;
    topKContrib: number;
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
    hillTau: input.params.kernel.hillTau,
    hillSteepness: input.params.kernel.hillSteepness,
    betaLex: input.params.kernel.betaLex,
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

  // Round 1 ANNEAL
  const anneal1 = annealLinks({
    links: round1LinkNodes,
    windowLinks: input.params.anneal.windowLinks,
    hillTau: input.params.anneal.hillTau,
    hillSteepness: input.params.anneal.hillSteepness,
    betaLex: input.params.anneal.betaLex,
    lambda: input.params.anneal.lambda,
    topKContrib: input.params.anneal.topKContrib,
  });

  const round1AnnealMetrics: RoundMetrics = {
    round: 1,
    phase: "anneal",
    label: "anneal",
    timestamp_ms: Date.now(),
    counts: {
      nodes: anneal1.links.length,
      neighbor_edges: anneal1.neighborEdges.length,
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
    neighborEdges: anneal1.neighborEdges,
    metrics: round1AnnealMetrics,
    massDeltaTsv: anneal1.massDeltaTsv,
  });

  let prevLevelMap = new Map(anneal1.links.map((node) => [node.id, node]));
  let currentRoundNodes = anneal1.links;

  // ROUND 2: Link-Links (L1 -> L2)
  if (input.params.maxLevel >= 2) {
    const linkLink2 = linkLinksKernel({
      sessionId: input.sessionId,
      nodes: currentRoundNodes,
      params: {
        kLocalLinks: input.params.linkLinks.kLocalLinks,
        hillTau: input.params.linkLinks.hillTau,
        hillSteepness: input.params.linkLinks.hillSteepness,
        betaLex: input.params.linkLinks.betaLex,
        minBridge: input.params.linkLinks.minBridge,
        maxForwardLines: input.params.linkLinks.maxForwardLines,
      },
    });

    const round2LinkNodes = [...linkLink2.composites, ...linkLink2.unpaired];

    const round2LinkMetrics: RoundMetrics = {
      round: 2,
      phase: "link",
      label: "link",
      timestamp_ms: Date.now(),
      counts: {
        nodes_total: round2LinkNodes.length,
        pairs_formed: linkLink2.composites.length,
        unpaired_total: linkLink2.unpaired.length,
      },
      stats: {
        strength_bridge: stats(round2LinkNodes.map(getStrengthBridge)),
        strength_internal: stats(round2LinkNodes.map(getStrengthInternal)),
        mass: stats(round2LinkNodes.map(getMass)),
      },
    };

    allRounds.push({
      round: 2,
      phase: "link",
      nodes: round2LinkNodes,
      neighborEdges: [],
      metrics: round2LinkMetrics,
      candidates: linkLink2.candidates,
    });

    // Round 2 ANNEAL
    const anneal2 = annealLinks({
      links: round2LinkNodes,
      windowLinks: input.params.anneal.windowLinks,
      hillTau: input.params.anneal.hillTau,
      hillSteepness: input.params.anneal.hillSteepness,
      betaLex: input.params.anneal.betaLex,
      lambda: input.params.anneal.lambda,
      topKContrib: input.params.anneal.topKContrib,
    });

    // Propagate current level's internal strengths into composites
    propagateInternalStrength(anneal2.links, prevLevelMap);

    const round2AnnealMetrics: RoundMetrics = {
      round: 2,
      phase: "anneal",
      label: "anneal",
      timestamp_ms: Date.now(),
      counts: {
        nodes: anneal2.links.length,
        neighbor_edges: anneal2.neighborEdges.length,
      },
      stats: {
        strength_internal: stats(anneal2.links.map(getStrengthInternal)),
        mass: stats(anneal2.links.map(getMass)),
      },
    };

    allRounds.push({
      round: 2,
      phase: "anneal",
      nodes: anneal2.links,
      neighborEdges: anneal2.neighborEdges,
      metrics: round2AnnealMetrics,
      massDeltaTsv: anneal2.massDeltaTsv,
    });

    prevLevelMap = new Map(anneal2.links.map((node) => [node.id, node]));
    currentRoundNodes = anneal2.links;
  }

  // ROUND 3: Link-Links (L2 -> L3)
  if (input.params.maxLevel >= 3) {
    const linkLink3 = linkLinksKernel({
      sessionId: input.sessionId,
      nodes: currentRoundNodes,
      params: {
        kLocalLinks: input.params.linkLinks.kLocalLinks,
        hillTau: input.params.linkLinks.hillTau,
        hillSteepness: input.params.linkLinks.hillSteepness,
        betaLex: input.params.linkLinks.betaLex,
        minBridge: input.params.linkLinks.minBridge,
        maxForwardLines: input.params.linkLinks.maxForwardLines,
      },
    });

    const round3LinkNodes = [...linkLink3.composites, ...linkLink3.unpaired];

    const round3LinkMetrics: RoundMetrics = {
      round: 3,
      phase: "link",
      label: "link",
      timestamp_ms: Date.now(),
      counts: {
        nodes_total: round3LinkNodes.length,
        pairs_formed: linkLink3.composites.length,
        unpaired_total: linkLink3.unpaired.length,
      },
      stats: {
        strength_bridge: stats(round3LinkNodes.map(getStrengthBridge)),
        strength_internal: stats(round3LinkNodes.map(getStrengthInternal)),
        mass: stats(round3LinkNodes.map(getMass)),
      },
    };

    allRounds.push({
      round: 3,
      phase: "link",
      nodes: round3LinkNodes,
      neighborEdges: [],
      metrics: round3LinkMetrics,
      candidates: linkLink3.candidates,
    });

    // Round 3 ANNEAL
    const anneal3 = annealLinks({
      links: round3LinkNodes,
      windowLinks: input.params.anneal.windowLinks,
      hillTau: input.params.anneal.hillTau,
      hillSteepness: input.params.anneal.hillSteepness,
      betaLex: input.params.anneal.betaLex,
      lambda: input.params.anneal.lambda,
      topKContrib: input.params.anneal.topKContrib,
    });

    // Propagate current level's internal strengths into composites
    propagateInternalStrength(anneal3.links, prevLevelMap);

    const round3AnnealMetrics: RoundMetrics = {
      round: 3,
      phase: "anneal",
      label: "anneal",
      timestamp_ms: Date.now(),
      counts: {
        nodes: anneal3.links.length,
        neighbor_edges: anneal3.neighborEdges.length,
      },
      stats: {
        strength_internal: stats(anneal3.links.map(getStrengthInternal)),
        mass: stats(anneal3.links.map(getMass)),
      },
    };

    allRounds.push({
      round: 3,
      phase: "anneal",
      nodes: anneal3.links,
      neighborEdges: anneal3.neighborEdges,
      metrics: round3AnnealMetrics,
      massDeltaTsv: anneal3.massDeltaTsv,
    });

    currentRoundNodes = anneal3.links;
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
