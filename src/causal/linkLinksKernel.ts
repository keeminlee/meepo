import { distanceScoreHill } from "./textFeatures.js";
import type { CausalLink } from "./types.js";
import { inferNodeKind } from "./nodeKind.js";

export type LinkLinkParams = {
  kLocalLinks: number;
  hillTau: number;
  hillSteepness: number;
  betaLex: number;
  minBridge: number;
  tLinkBase?: number;
  tLinkK?: number;
  maxForwardLines: number;
};

export type LinkLinkCandidate = {
  left_id: string;
  right_id: string;
  left_center: number;
  right_center: number;
  center_distance: number;
  lexical_score: number;
  strength_bridge: number;
  threshold_link: number;
  chosen: boolean;
};

export type LinkLinkOutput = {
  composites: CausalLink[];
  unpaired: CausalLink[];
  candidates: LinkLinkCandidate[];
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

function getCenterIndex(link: CausalLink): number {
  if (typeof link.center_index === "number") return link.center_index;
  const cause = link.cause_anchor_index ?? link.intent_anchor_index;
  const effect = link.effect_anchor_index ?? link.consequence_anchor_index;
  if (typeof effect === "number") return (cause + effect) / 2;
  return cause;
}

function getSpanStart(link: CausalLink): number {
  if (typeof link.span_start_index === "number") return link.span_start_index;
  const cause = link.cause_anchor_index ?? link.intent_anchor_index;
  const effect = link.effect_anchor_index ?? link.consequence_anchor_index;
  if (typeof effect === "number") return Math.min(cause, effect);
  return cause;
}

function getSpanEnd(link: CausalLink): number {
  if (typeof link.span_end_index === "number") return link.span_end_index;
  const cause = link.cause_anchor_index ?? link.intent_anchor_index;
  const effect = link.effect_anchor_index ?? link.consequence_anchor_index;
  if (typeof effect === "number") return Math.max(cause, effect);
  return cause;
}

function ensureStrengthInternal(link: CausalLink): number {
  if (typeof link.strength_internal === "number") return link.strength_internal;
  if (typeof link.strength_bridge === "number") return link.strength_bridge;
  if (typeof link.strength_ce === "number") return link.strength_ce;
  if (typeof link.score === "number") return link.score;
  return 0;
}

function getNodeMass(link: CausalLink): number {
  return link.mass ?? link.link_mass ?? link.mass_base ?? link.cause_mass ?? 0;
}

function thresholdForLinkMasses(params: LinkLinkParams, massA: number, massB: number): number {
  const t0 = params.tLinkBase ?? params.minBridge;
  const k = params.tLinkK ?? 0.15;
  return t0 + k * Math.log(1 + Math.sqrt(Math.max(0, massA) * Math.max(0, massB)));
}

function computeNextLevel(left: CausalLink, right: CausalLink): 1 | 2 | 3 {
  const leftLevel = (left.level ?? 1) as 1 | 2 | 3;
  const rightLevel = (right.level ?? 1) as 1 | 2 | 3;
  const baseLevel = Math.max(leftLevel, rightLevel) as 1 | 2 | 3;

  const leftKind = inferNodeKind(left);
  const rightKind = inferNodeKind(right);
  const shouldPromote = leftKind !== "singleton" && rightKind !== "singleton";

  if (!shouldPromote) {
    return baseLevel;
  }

  return Math.min(3, baseLevel + 1) as 1 | 2 | 3;
}

function cloneForNextLevel(link: CausalLink, level: 1 | 2 | 3): CausalLink {
  const strengthInternal = ensureStrengthInternal(link);
  return {
    ...link,
    level,
    node_kind: inferNodeKind(link),
    strength_internal: strengthInternal,
    strength_bridge: link.strength_bridge ?? link.strength_ce ?? link.score ?? 0,
    span_start_index: getSpanStart(link),
    span_end_index: getSpanEnd(link),
    center_index: getCenterIndex(link),
  };
}

export function linkLinksKernel(input: {
  sessionId: string;
  nodes: CausalLink[];
  params: LinkLinkParams;
}): LinkLinkOutput {
  const nodes = input.nodes.map((node) => cloneForNextLevel(node, node.level ?? 1));
  const centers = nodes.map(getCenterIndex);
  const texts = nodes.map(getLinkText);

  type PairCandidate = {
    leftIndex: number;
    rightIndex: number;
    strength_bridge: number;
    threshold_link: number;
    center_distance: number;
    lexical_score: number;
  };

  const candidates: PairCandidate[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const forward: Array<{ index: number; center_distance: number }> = [];
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const center_distance = centers[j] - centers[i];
      if (center_distance <= 0 || center_distance > input.params.maxForwardLines) continue;
      forward.push({ index: j, center_distance });
    }

    forward.sort((a, b) => a.center_distance - b.center_distance || a.index - b.index);
    const local = forward.slice(0, input.params.kLocalLinks);

    for (const { index: j, center_distance } of local) {
      const distStrength = distanceScoreHill(center_distance, input.params.hillTau, input.params.hillSteepness);
      const lexical_score = scoreTokenOverlap(texts[i], texts[j]);
      const strength_bridge = distStrength * (1 + input.params.betaLex * lexical_score);
      const leftMass = getNodeMass(nodes[i]);
      const rightMass = getNodeMass(nodes[j]);
      const threshold_link = thresholdForLinkMasses(input.params, leftMass, rightMass);
      if (strength_bridge < threshold_link) continue;
      candidates.push({
        leftIndex: i,
        rightIndex: j,
        strength_bridge,
        threshold_link,
        center_distance,
        lexical_score,
      });
    }
  }

  candidates.sort((a, b) => {
    if (b.strength_bridge !== a.strength_bridge) return b.strength_bridge - a.strength_bridge;
    if (a.center_distance !== b.center_distance) return a.center_distance - b.center_distance;
    const aCenter = centers[a.leftIndex] ?? 0;
    const bCenter = centers[b.leftIndex] ?? 0;
    if (aCenter !== bCenter) return aCenter - bCenter;
    return nodes[a.leftIndex].id.localeCompare(nodes[b.leftIndex].id);
  });

  const used = new Set<number>();
  const composites: CausalLink[] = [];
  const chosenPairs = new Set<string>();

  for (const candidate of candidates) {
    if (used.has(candidate.leftIndex) || used.has(candidate.rightIndex)) continue;
    used.add(candidate.leftIndex);
    used.add(candidate.rightIndex);

    const left = nodes[candidate.leftIndex];
    const right = nodes[candidate.rightIndex];

    const nextLevel = computeNextLevel(left, right);
    const spanStart = Math.min(getSpanStart(left), getSpanStart(right));
    const spanEnd = Math.max(getSpanEnd(left), getSpanEnd(right));
    const center = (getCenterIndex(left) + getCenterIndex(right)) / 2;
    const leftText = getLinkText(left);
    const rightText = getLinkText(right);
    const leftMass = getNodeMass(left);
    const rightMass = getNodeMass(right);
    const leftInternal = ensureStrengthInternal(left);
    const rightInternal = ensureStrengthInternal(right);
    const strengthInternal = candidate.strength_bridge + leftInternal + rightInternal;
    const massBase = leftMass + rightMass + strengthInternal;

    const composite: CausalLink = {
      ...left,
      id: `${left.id}+${right.id}`,
      session_id: input.sessionId,
      node_kind: "composite",
      cause_text: leftText,
      effect_text: rightText,
      level: nextLevel,
      members: [left.id, right.id],
      strength_bridge: candidate.strength_bridge,
      strength_internal: strengthInternal,
      join_center_distance: candidate.center_distance,
      join_lexical_score: candidate.lexical_score,
      span_start_index: spanStart,
      span_end_index: spanEnd,
      center_index: center,
      mass_base: massBase,
      mass: massBase,
      link_mass: massBase,
      mass_boost: 0,
      intent_text: leftText,
      consequence_text: rightText,
      claimed: true,
      created_at_ms: Date.now(),
    };

    composites.push(composite);
    chosenPairs.add(`${left.id}::${right.id}`);
  }

  const unpaired: CausalLink[] = nodes
    .filter((_, idx) => !used.has(idx))
    .map((node) => {
      const sameLevel = (node.level ?? 1) as 1 | 2 | 3;
      return cloneForNextLevel(node, sameLevel);
    });

  const candidateRecords: LinkLinkCandidate[] = candidates.map((candidate) => ({
    left_id: nodes[candidate.leftIndex].id,
    right_id: nodes[candidate.rightIndex].id,
    left_center: centers[candidate.leftIndex] ?? 0,
    right_center: centers[candidate.rightIndex] ?? 0,
    center_distance: candidate.center_distance,
    lexical_score: candidate.lexical_score,
    strength_bridge: candidate.strength_bridge,
    threshold_link: candidate.threshold_link,
    chosen: chosenPairs.has(`${nodes[candidate.leftIndex].id}::${nodes[candidate.rightIndex].id}`),
  }));

  return {
    composites,
    unpaired,
    candidates: candidateRecords,
  };
}
