import { distanceScoreHill } from "./textFeatures.js";
import type { CausalLink } from "./types.js";
import type { ContextEdge, CyclePhaseMetrics, MetricStats, SingletonNode } from "./cycleTypes.js";

export interface AbsorbInput {
  links: CausalLink[];
  singletonCauses: SingletonNode[];
  singletonEffects: SingletonNode[];
  radiusBase: number;
  radiusPerMass: number;
  capBase: number;
  capPerMass: number;
  minCtxStrength: number;
  hillTau: number;
  hillSteepness: number;
  betaLex: number;
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
  const tokens1 = new Set(text1.toLowerCase().split(/\s+/).filter((t) => t.length > 2));
  const tokens2 = new Set(text2.toLowerCase().split(/\s+/).filter((t) => t.length > 2));
  if (tokens1.size === 0 || tokens2.size === 0) return 0;
  const overlap = Array.from(tokens1).filter((t) => tokens2.has(t)).length;
  return overlap / Math.max(tokens1.size, tokens2.size);
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

  const candidates: Candidate[] = [];
  for (const singleton of [...singletonCauses, ...singletonEffects]) {
    for (const link of links) {
      const linkMass = getLinkMass(link);
      const radius = input.radiusBase + input.radiusPerMass * linkMass;
      const center = getLinkCenter(link);
      const distance = Math.abs(singleton.anchor_index - center);
      if (distance > radius) continue;

      const distanceScore = distanceScoreHill(distance, input.hillTau, input.hillSteepness);
      const lexical = scoreTokenOverlap(singleton.text, getLinkText(link));
      const strength = distanceScore * (1 + input.betaLex * lexical);
      if (strength < input.minCtxStrength) continue;

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
