import { buildTranscript } from "../ledger/transcripts.js";
import { buildDmNameSet, detectDmSpeaker, isDmSpeaker } from "../ledger/scaffoldSpeaker.js";
import type { RegimeChunk, RegimeMasks } from "./pruneRegimes.js";
import { buildEligibilityMask } from "./eligibilityMask.js";
import { CAUSAL_KERNEL_VERSION, extractCausalLinksKernel } from "./extractCausalLinksKernel.js";
import { persistCausalLinks } from "./persistCausalLinks.js";
import type { CausalLink } from "./types.js";
import { distanceScoreHill } from "./textFeatures.js";
import type { CandidateEdge, ConsequenceNode, GraphParams, IntentNode, LinkGraphEdge, LinkGraphNode } from "./intentGraphTypes.js";
import type { ActorLike } from "./actorFeatures.js";

function scoreTokenOverlap(text1: string, text2: string): number {
  const tokens1 = new Set(text1.toLowerCase().split(/\s+/).filter((t) => t.length > 2));
  const tokens2 = new Set(text2.toLowerCase().split(/\s+/).filter((t) => t.length > 2));

  if (tokens1.size === 0 || tokens2.size === 0) return 0;
  const overlap = Array.from(tokens1).filter((t) => tokens2.has(t)).length;
  return overlap / Math.max(tokens1.size, tokens2.size);
}

function toLinkNode(link: CausalLink): LinkGraphNode {
  const causeText = link.cause_text ?? link.intent_text;
  const effectText = link.effect_text ?? link.consequence_text ?? "";
  const text = `${causeText} ${effectText}`.trim();
  const causeAnchor = link.cause_anchor_index ?? link.intent_anchor_index;
  const effectAnchor = link.effect_anchor_index ?? link.consequence_anchor_index;
  const massBase = typeof link.cause_mass === "number"
    ? link.cause_mass + (typeof link.effect_mass === "number" ? link.effect_mass : 0)
    : null;

  return {
    link_id: link.id,
    session_id: link.session_id,
    actor_id: link.actor,
    cause_anchor_index: causeAnchor,
    effect_anchor_index: effectAnchor,
    center_index: link.center_index ?? (typeof effectAnchor === "number" ? Math.round((causeAnchor + effectAnchor) / 2) : causeAnchor),
    claimed: link.claimed,
    cause_type: link.cause_type ?? link.intent_type,
    effect_type: link.effect_type ?? link.consequence_type,
    strength: link.strength ?? link.strength_ce ?? link.score ?? null,
    mass_base: massBase,
    mass: link.mass ?? link.link_mass ?? massBase,
    mass_boost: link.mass_boost ?? null,
    text,
  };
}

function buildLinkEdges(params: {
  sessionId: string;
  nodes: LinkGraphNode[];
  graphParams: GraphParams;
}): LinkGraphEdge[] {
  const out: LinkGraphEdge[] = [];
  const window = Math.max(1, params.graphParams.maxBack);

  for (let i = 0; i < params.nodes.length; i++) {
    for (let j = i + 1; j < params.nodes.length; j++) {
      const a = params.nodes[i];
      const b = params.nodes[j];
      const centerDistance = Math.abs(a.center_index - b.center_index);
      if (centerDistance > window) continue;

      const distanceStrength = distanceScoreHill(
        centerDistance,
        params.graphParams.distTau,
        params.graphParams.distP,
      );
      const lexicalOverlap = scoreTokenOverlap(a.text, b.text);
      const strengthLL = distanceStrength * (1 + params.graphParams.betaLex * lexicalOverlap);

      out.push({
        edge_id: `LL:${a.link_id}:${b.link_id}`,
        session_id: params.sessionId,
        source_link_id: a.link_id,
        target_link_id: b.link_id,
        center_distance: centerDistance,
        distance_strength: distanceStrength,
        lexical_overlap: lexicalOverlap,
        strength_ll: strengthLL,
      });
    }
  }

  return out;
}

export function extractIntentGraph(params: {
  sessionId: string;
  chunks: RegimeChunk[];
  masks: RegimeMasks;
  includeOocSoft: boolean;
  actors: ActorLike[];
  graphParams: GraphParams;
  links?: CausalLink[];
  persistComputedLinks?: boolean;
}): {
  transcript: ReturnType<typeof buildTranscript>;
  bundles: [];
  intents: IntentNode[];
  consequences: ConsequenceNode[];
  edges: CandidateEdge[];
  calibratedLexK: number;
  links: CausalLink[];
  linkNodes: LinkGraphNode[];
  linkEdges: LinkGraphEdge[];
} {
  const transcript = buildTranscript(params.sessionId, true);
  const uniqueSpeakers = Array.from(new Set(transcript.map((l) => l.author_name)));
  const detectedDm = detectDmSpeaker(uniqueSpeakers);
  const dmNames = buildDmNameSet(detectedDm);

  const mask = buildEligibilityMask(transcript, params.masks, params.sessionId);

  if (params.includeOocSoft) {
    for (const span of params.masks.oocSoft) {
      for (let i = span.start_index; i <= span.end_index; i++) {
        mask.eligible_mask[i] = true;
      }
    }
    mask.excluded_ranges = mask.excluded_ranges.filter((r) => r.reason !== "ooc_soft");
  }

  const links = params.links ?? extractCausalLinksKernel({
    sessionId: params.sessionId,
    transcript,
    eligibilityMask: mask,
    actors: params.actors,
    dmSpeaker: dmNames,
    kLocal: Math.max(1, params.graphParams.maxBack),
    hillTau: params.graphParams.distTau,
    hillSteepness: params.graphParams.distP,
    betaLex: params.graphParams.betaLex,
    betaLexLL: params.graphParams.betaLex,
    linkWindow: Math.max(1, params.graphParams.maxBack),
    requireClaimedNeighbors: true,
  }).links;

  if (!params.links && params.persistComputedLinks) {
    persistCausalLinks(params.sessionId, links, {
      kernelVersion: CAUSAL_KERNEL_VERSION,
      kernelParams: {
        kLocal: Math.max(1, params.graphParams.maxBack),
        hillTau: params.graphParams.distTau,
        hillSteepness: params.graphParams.distP,
        betaLex: params.graphParams.betaLex,
        betaLexLL: params.graphParams.betaLex,
      },
    });
  }

  const linkNodes = links.map(toLinkNode);
  const linkEdges = buildLinkEdges({
    sessionId: params.sessionId,
    nodes: linkNodes,
    graphParams: params.graphParams,
  });

  return {
    transcript,
    bundles: [],
    intents: [],
    consequences: [],
    edges: [],
    calibratedLexK: params.graphParams.lexK > 0 ? params.graphParams.lexK : 1,
    links,
    linkNodes,
    linkEdges,
  };
}
