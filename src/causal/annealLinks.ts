import { distanceScoreHill } from "./textFeatures.js";
import type { CausalLink } from "./types.js";
import type { CyclePhaseMetrics, MetricStats, NeighborEdgeTrace } from "./cycleTypes.js";

export interface AnnealInput {
  links: CausalLink[];
  windowLinks: number;
  hillTau: number;
  hillSteepness: number;
  betaLex: number;
  lambda: number;
  topKContrib: number;
  includeContextText?: boolean;
  contextByLinkId?: Map<string, string[]>;
  tierThresholds?: { beat: number; event: number; scene: number };
}

export interface AnnealOutput {
  links: CausalLink[];
  neighborEdges: NeighborEdgeTrace[];
  metrics: CyclePhaseMetrics;
  massDeltaTsv: string;
}

function scoreTokenOverlap(text1: string, text2: string): number {
  const tokens1 = new Set(text1.toLowerCase().split(/\s+/).filter((t) => t.length > 2));
  const tokens2 = new Set(text2.toLowerCase().split(/\s+/).filter((t) => t.length > 2));
  if (tokens1.size === 0 || tokens2.size === 0) return 0;
  const overlap = Array.from(tokens1).filter((t) => tokens2.has(t)).length;
  return overlap / Math.max(tokens1.size, tokens2.size);
}

function getLinkText(link: CausalLink, contextByLinkId?: Map<string, string[]>, includeContextText?: boolean): string {
  const causeText = link.cause_text ?? link.intent_text;
  const effectText = link.effect_text ?? link.consequence_text ?? "";
  const base = `${causeText} ${effectText}`.trim();
  if (!includeContextText || !contextByLinkId) return base;
  const ctx = contextByLinkId.get(link.id) ?? [];
  if (ctx.length === 0) return base;
  return `${base} ${ctx.join(" ")}`.trim();
}

function getCenterIndex(link: CausalLink): number {
  const cause = link.cause_anchor_index ?? link.intent_anchor_index;
  const effect = link.effect_anchor_index ?? link.consequence_anchor_index;
  if (typeof effect === "number") return (cause + effect) / 2;
  return cause;
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

function computeTier(mass: number, thresholds?: { beat: number; event: number; scene: number }): CausalLink["tier"] {
  if (!thresholds) return "link";
  if (mass >= thresholds.scene) return "scene";
  if (mass >= thresholds.event) return "event";
  if (mass >= thresholds.beat) return "beat";
  return "link";
}

export function annealLinks(input: AnnealInput): AnnealOutput {
  const links = input.links.map((l) => ({ ...l }));
  const centers = links.map(getCenterIndex);
  const texts = links.map((l) => getLinkText(l, input.contextByLinkId, input.includeContextText));
  const massPrev = links.map((l) => l.mass ?? l.link_mass ?? l.mass_base ?? l.cause_mass ?? 0);
  const tierPrev = links.map((l) => l.tier ?? "link");

  const neighborEdges: NeighborEdgeTrace[] = [];
  const massBoosts: number[] = [];
  const massBases: number[] = [];

  for (let i = 0; i < links.length; i++) {
    const candidates: Array<NeighborEdgeTrace> = [];
    let totalContrib = 0;
    for (let j = 0; j < links.length; j++) {
      if (i === j) continue;
      const dist = Math.abs(centers[i] - centers[j]);
      if (dist > input.windowLinks) continue;
      const distStrength = distanceScoreHill(dist, input.hillTau, input.hillSteepness);
      const lexical = scoreTokenOverlap(texts[i], texts[j]);
      const strengthLl = distStrength * (1 + input.betaLex * lexical);
      const contrib = strengthLl * massPrev[j];
      totalContrib += contrib;
      candidates.push({
        from_link_id: links[j].id,
        to_link_id: links[i].id,
        strength_ll: strengthLl,
        contrib,
        distance: dist,
        lexical,
      });
    }

    candidates.sort((a, b) => {
      if (b.contrib !== a.contrib) return b.contrib - a.contrib;
      if (a.distance !== b.distance) return a.distance - b.distance;
      return a.from_link_id.localeCompare(b.from_link_id);
    });

    const top = candidates.slice(0, input.topKContrib);
    neighborEdges.push(...top);

    const boost = totalContrib * input.lambda;
    const base = massPrev[i];
    const nextMass = base + boost;

    links[i].mass_base = base;
    links[i].mass_boost = boost;
    links[i].mass = nextMass;
    links[i].link_mass = nextMass;
    links[i].center_index = centers[i];
    links[i].tier = computeTier(nextMass, input.tierThresholds);

    massBoosts.push(boost);
    massBases.push(base);
  }

  const metrics: CyclePhaseMetrics = {
    cycle: 0,
    phase: "anneal",
    label: "anneal",
    timestamp_ms: Date.now(),
    counts: {
      links: links.length,
      neighbor_edges: neighborEdges.length,
    },
    stats: {
      mass_base: stats(massBases),
      mass_boost: stats(massBoosts),
      mass: stats(links.map((l) => l.mass ?? 0)),
    },
  };

  const lines: string[] = [
    "link_id\tmass_base\tmass_prev\tmass_new\tboost\ttier_prev\ttier_new\ttop_contributor_link_id",
  ];
  for (let i = 0; i < links.length; i++) {
    const base = massPrev[i];
    const nextMass = links[i].mass ?? base;
    const boost = links[i].mass_boost ?? 0;
    const topContributor = neighborEdges.find((edge) => edge.to_link_id === links[i].id)?.from_link_id ?? "";
    const prev = tierPrev[i] ?? "link";
    const next = links[i].tier ?? "link";
    lines.push(
      `${links[i].id}\t${base.toFixed(3)}\t${base.toFixed(3)}\t${nextMass.toFixed(3)}\t${boost.toFixed(3)}\t${prev}\t${next}\t${topContributor}`,
    );
  }

  return {
    links,
    neighborEdges,
    metrics,
    massDeltaTsv: lines.join("\n"),
  };
}
