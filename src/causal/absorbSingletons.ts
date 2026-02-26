import { distanceScoreHill } from "./textFeatures.js";
import type { CausalLink } from "./types.js";
import type { ContextEdge, CyclePhaseMetrics, MetricStats, SingletonNode } from "./cycleTypes.js";
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

export interface AbsorbInput {
  links: CausalLink[];
  singletonCauses: SingletonNode[];
  singletonEffects: SingletonNode[];
  radiusBase: number;
  radiusPerMass: number;
  capBase: number;
  capPerMass: number;
  minCtxStrength: number;
  ctxThresholdBase?: number;
  ctxThresholdPerLogMass?: number;
  hillTau: number;
  hillSteepness: number;
  betaLex: number;
  levers?: LeverParams;
}

export interface AbsorbOutput {
  links: CausalLink[];
  contextEdges: ContextEdge[];
  singletonCauses: SingletonNode[];
  singletonEffects: SingletonNode[];
  metrics: CyclePhaseMetrics;
  contextByLinkId: Map<string, string[]>;
}

type Candidate = {
  singleton: SingletonNode;
  link: CausalLink;
  strength: number;
  distance: number;
  lexical: number;
};

function scoreTokenOverlap(text1: string, text2: string): number {
  return scoreTokenOverlapSimple(text1, text2);
}

function getLinkText(link: CausalLink): string {
  const causeText = link.cause_text ?? link.intent_text;
  const effectText = link.effect_text ?? link.consequence_text ?? "";
  return `${causeText} ${effectText}`.trim();
}

function getLinkCenter(link: CausalLink): number {
  if (typeof link.center_index === "number") return link.center_index;
  const cause = link.cause_anchor_index ?? link.intent_anchor_index;
  const effect = link.effect_anchor_index ?? link.consequence_anchor_index;
  if (typeof effect === "number") return (cause + effect) / 2;
  return cause;
}

function getLinkMass(link: CausalLink): number {
  return link.mass ?? link.link_mass ?? link.mass_base ?? link.cause_mass ?? 0;
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

export function absorbSingletons(input: AbsorbInput): AbsorbOutput {
  const links = input.links.map((l) => ({ ...l }));
  const singletonCauses = [...input.singletonCauses];
  const singletonEffects = [...input.singletonEffects];
  const contextEdges: ContextEdge[] = [];
  const contextByLinkId = new Map<string, string[]>();
  const tau = input.levers ? localityToTau(input.levers.locality) : input.hillTau;
  const corpusStats = input.levers
    ? buildLexicalCorpusStats([
        ...links.map((l) => getLinkText(l)),
        ...singletonCauses.map((s) => s.text),
        ...singletonEffects.map((s) => s.text),
      ])
    : undefined;

  const candidates: Candidate[] = [];
  for (const singleton of [...singletonCauses, ...singletonEffects]) {
    for (const link of links) {
      const linkMass = getLinkMass(link);
      const radius = input.radiusBase + input.radiusPerMass * linkMass;
      const center = getLinkCenter(link);
      const distance = Math.abs(singleton.anchor_index - center);
      if (distance > radius) continue;

      const distanceScore = distanceScoreHill(distance, tau, input.hillSteepness);
      const linkText = getLinkText(link);
      const { lexicalScore: lexical, keywordOverlap } = input.levers
        ? lexicalSignals(singleton.text, linkText, corpusStats)
        : { lexicalScore: scoreTokenOverlap(singleton.text, linkText), keywordOverlap: 0 };
      const strength = input.levers
        ? evidenceToStrength(
            evidenceFromDistanceLexical(
              distanceScore,
              Math.min(1, lexical * (1 + keywordOverlap * (input.levers.keywordLexBonus ?? 0.25))),
            ),
            input.levers.coupling,
            input.levers.strengthScale ?? 2,
          )
        : distanceScore * (1 + input.betaLex * lexical);
      const thresholdCtx =
        typeof input.ctxThresholdBase === "number"
          ? input.ctxThresholdBase + (input.ctxThresholdPerLogMass ?? 0) * Math.log(1 + Math.max(0, singleton.mass))
          : input.minCtxStrength;
      if (strength < thresholdCtx) continue;

      candidates.push({ singleton, link, strength, distance, lexical });
    }
  }

  candidates.sort((a, b) => {
    if (b.strength !== a.strength) return b.strength - a.strength;
    if (b.singleton.mass !== a.singleton.mass) return b.singleton.mass - a.singleton.mass;
    if (a.distance !== b.distance) return a.distance - b.distance;
    if (a.singleton.anchor_index !== b.singleton.anchor_index) return a.singleton.anchor_index - b.singleton.anchor_index;
    if (a.singleton.id !== b.singleton.id) return a.singleton.id.localeCompare(b.singleton.id);
    return a.link.id.localeCompare(b.link.id);
  });

  const linkCaps = new Map<string, number>();
  const linkUsed = new Map<string, number>();
  for (const link of links) {
    const cap = Math.max(0, Math.floor(input.capBase + input.capPerMass * getLinkMass(link)));
    linkCaps.set(link.id, cap);
    linkUsed.set(link.id, 0);
  }

  const attachedSingletons = new Set<string>();
  const ctxStrengths: number[] = [];

  for (const candidate of candidates) {
    const singletonId = candidate.singleton.id;
    if (attachedSingletons.has(singletonId)) continue;

    const cap = linkCaps.get(candidate.link.id) ?? 0;
    const used = linkUsed.get(candidate.link.id) ?? 0;
    if (used >= cap) continue;

    attachedSingletons.add(singletonId);
    linkUsed.set(candidate.link.id, used + 1);
    ctxStrengths.push(candidate.strength);

    const edge: ContextEdge = {
      singleton_id: singletonId,
      link_id: candidate.link.id,
      strength_ctx: candidate.strength,
      distance: candidate.distance,
      lexical: candidate.lexical,
      singleton_kind: candidate.singleton.kind,
      singleton_anchor_index: candidate.singleton.anchor_index,
      link_center_index: getLinkCenter(candidate.link),
      created_at_ms: Date.now(),
    };
    contextEdges.push(edge);

    const arr = contextByLinkId.get(candidate.link.id) ?? [];
    arr.push(candidate.singleton.text);
    contextByLinkId.set(candidate.link.id, arr);

    const currentMass = getLinkMass(candidate.link);
    const addedMass = Math.max(0, candidate.singleton.mass ?? 0);
    const nextMass = currentMass + addedMass;
    candidate.link.mass = nextMass;
    candidate.link.link_mass = nextMass;
    candidate.link.mass_boost = (candidate.link.mass_boost ?? 0) + addedMass;

    const ctxIndices = new Set<number>(candidate.link.context_line_indices ?? []);
    ctxIndices.add(candidate.singleton.anchor_index);
    candidate.link.context_line_indices = Array.from(ctxIndices).sort((a, b) => a - b);
  }

  for (const link of links) {
    link.context_count = linkUsed.get(link.id) ?? 0;
  }

  const remainingCauses = singletonCauses.filter((s) => !attachedSingletons.has(s.id));
  const remainingEffects = singletonEffects.filter((s) => !attachedSingletons.has(s.id));

  const metrics: CyclePhaseMetrics = {
    cycle: 0,
    phase: "link",
    label: "link",
    timestamp_ms: Date.now(),
    counts: {
      singleton_causes_attached: singletonCauses.length - remainingCauses.length,
      singleton_causes_total: singletonCauses.length,
      singleton_effects_attached: singletonEffects.length - remainingEffects.length,
      singleton_effects_total: singletonEffects.length,
      context_edges: contextEdges.length,
      links: links.length,
    },
    stats: {
      ctx_strength: stats(ctxStrengths),
    },
  };

  return {
    links,
    contextEdges,
    singletonCauses: remainingCauses,
    singletonEffects: remainingEffects,
    metrics,
    contextByLinkId,
  };
}
