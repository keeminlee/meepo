import { createHash } from "node:crypto";
import type { TranscriptEntry } from "../ledger/transcripts.js";
import type { ActorLike } from "./actorFeatures.js";
import type { EligibilityMask } from "./types.js";
import { CAUSAL_KERNEL_VERSION, extractCausalLinksKernel, type KernelInput } from "./extractCausalLinksKernel.js";
import { annealLinks } from "./annealLinks.js";
import { absorbSingletons } from "./absorbSingletons.js";
import { extractSingletonsFromKernelOutput } from "./singletons.js";
import type { CyclePhaseMetrics, CyclePhaseState, MetricStats, SingletonNode } from "./cycleTypes.js";
import type { CausalLink } from "./types.js";

export type CausalCyclesParams = {
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
    includeContextText?: boolean;
  };
  absorb: {
    radiusBase: number;
    radiusPerMass: number;
    capBase: number;
    capPerMass: number;
    minCtxStrength: number;
    hillTau: number;
    hillSteepness: number;
    betaLex: number;
  };
};

export async function runCausalCycles(input: {
  sessionId: string;
  transcript: TranscriptEntry[];
  eligibilityMask: EligibilityMask;
  actors: ActorLike[];
  dmSpeaker: Set<string>;
  cycles?: number;
  params: CausalCyclesParams;
  debug?: { outDir?: string; emitArtifacts?: boolean };
}): Promise<{
  finalLinks: CausalLink[];
  allPhases: CyclePhaseState[];
  provenance: { kernel_version: string; params_json: string; param_hash: string };
}> {
  const cycles = input.cycles ?? 3;
  if (cycles !== 3) {
    throw new Error(`runCausalCycles expects cycles=3, got ${cycles}`);
  }

  const paramsJson = JSON.stringify(input.params);
  const paramHash = createHash("sha256").update(paramsJson).digest("hex").slice(0, 12);

  const phases: CyclePhaseState[] = [];

  // Cycle 0: link (kernel)
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
  const pairsFormed = kernelOutput.links.filter((l) => l.claimed).length;
  const effectsTotal = kernelOutput.effects?.length ?? 0;
  const effectsUnclaimed = kernelOutput.unclaimedEffects?.length ?? 0;
  const effectsUniqueClaimed = Math.max(0, effectsTotal - effectsUnclaimed);
  const linkPhaseMetrics: CyclePhaseMetrics = {
    cycle: 0,
    phase: "link",
    label: "link",
    timestamp_ms: Date.now(),
    counts: {
      causes: kernelOutput.links.length,
      causes_paired: pairsFormed,
      causes_unpaired: kernelOutput.links.filter((l) => !l.claimed).length,
      effects_total: effectsTotal,
      pairs_formed: pairsFormed,
      effects_unique_claimed: effectsUniqueClaimed,
      effects_unclaimed: effectsUnclaimed,
    },
    stats: {
      strength_ce: stats(kernelOutput.links.map((l) => l.strength_ce ?? l.score ?? 0)),
    },
  };

  phases.push({
    cycle: 0,
    phase: "link",
    links: kernelOutput.links,
    singletonCauses: [],
    singletonEffects: [],
    contextEdges: [],
    neighborEdges: [],
    metrics: linkPhaseMetrics,
    contextByLinkId: new Map(),
  });

  // Cycle 0: anneal
  const anneal0 = annealLinks({
    links: kernelOutput.links,
    windowLinks: input.params.anneal.windowLinks,
    hillTau: input.params.anneal.hillTau,
    hillSteepness: input.params.anneal.hillSteepness,
    betaLex: input.params.anneal.betaLex,
    lambda: input.params.anneal.lambda,
    topKContrib: input.params.anneal.topKContrib,
  });
  anneal0.metrics.cycle = 0;
  anneal0.metrics.phase = "anneal";
  anneal0.metrics.label = "anneal";
  anneal0.metrics.timestamp_ms = Date.now();

  phases.push({
    cycle: 0,
    phase: "anneal",
    links: anneal0.links,
    singletonCauses: [],
    singletonEffects: [],
    contextEdges: [],
    neighborEdges: anneal0.neighborEdges,
    metrics: anneal0.metrics,
    massDeltaTsv: anneal0.massDeltaTsv,
    contextByLinkId: new Map(),
  });

  // Prepare singletons from cycle 0 output
  const singletonExtract = extractSingletonsFromKernelOutput({
    sessionId: input.sessionId,
    links: anneal0.links,
    unclaimedEffects: kernelOutput.unclaimedEffects,
    keepUnclaimedLinks: false,
  });

  let links = singletonExtract.links;
  let singletonCauses = singletonExtract.singletonCauses;
  let singletonEffects = singletonExtract.singletonEffects;

  for (let cycle = 1; cycle <= 2; cycle++) {
    // Link phase: absorb singletons
    const allSingletons: SingletonNode[] = [...singletonCauses, ...singletonEffects];
    const absorb = absorbSingletons({
      links,
      singletonCauses,
      singletonEffects,
      radiusBase: input.params.absorb.radiusBase,
      radiusPerMass: input.params.absorb.radiusPerMass,
      capBase: input.params.absorb.capBase,
      capPerMass: input.params.absorb.capPerMass,
      minCtxStrength: input.params.absorb.minCtxStrength,
      hillTau: input.params.absorb.hillTau,
      hillSteepness: input.params.absorb.hillSteepness,
      betaLex: input.params.absorb.betaLex,
    });
    absorb.metrics.cycle = cycle;
    absorb.metrics.phase = "link";
    absorb.metrics.label = "link";
    absorb.metrics.timestamp_ms = Date.now();

    phases.push({
      cycle,
      phase: "link",
      links: absorb.links,
      singletonCauses: absorb.singletonCauses,
      singletonEffects: absorb.singletonEffects,
      contextEdges: absorb.contextEdges,
      neighborEdges: [],
      metrics: absorb.metrics,
      contextByLinkId: absorb.contextByLinkId,
    });

    // Build context text map for anneal
    const anneal = annealLinks({
      links: absorb.links,
      windowLinks: input.params.anneal.windowLinks,
      hillTau: input.params.anneal.hillTau,
      hillSteepness: input.params.anneal.hillSteepness,
      betaLex: input.params.anneal.betaLex,
      lambda: input.params.anneal.lambda,
      topKContrib: input.params.anneal.topKContrib,
      includeContextText: input.params.anneal.includeContextText ?? true,
      contextByLinkId: absorb.contextByLinkId,
    });
    anneal.metrics.cycle = cycle;
    anneal.metrics.phase = "anneal";
    anneal.metrics.label = "anneal";
    anneal.metrics.timestamp_ms = Date.now();

    phases.push({
      cycle,
      phase: "anneal",
      links: anneal.links,
      singletonCauses: absorb.singletonCauses,
      singletonEffects: absorb.singletonEffects,
      contextEdges: absorb.contextEdges,
      neighborEdges: anneal.neighborEdges,
      metrics: anneal.metrics,
      massDeltaTsv: anneal.massDeltaTsv,
      contextByLinkId: absorb.contextByLinkId,
    });

    links = anneal.links;
    singletonCauses = absorb.singletonCauses;
    singletonEffects = absorb.singletonEffects;
  }

  return {
    finalLinks: links,
    allPhases: phases,
    provenance: {
      kernel_version: CAUSAL_KERNEL_VERSION,
      params_json: paramsJson,
      param_hash: paramHash,
    },
  };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? 0;
}

function stats(values: number[]): MetricStats {
  if (values.length === 0) return { min: 0, p50: 0, p90: 0, max: 0 };
  return {
    min: Math.min(...values),
    p50: percentile(values, 50),
    p90: percentile(values, 90),
    max: Math.max(...values),
  };
}
