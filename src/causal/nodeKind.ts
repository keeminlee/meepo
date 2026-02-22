import type { CausalLink } from "./types.js";

export type NodeKind = "link" | "singleton" | "composite";

export function inferNodeKind(link: CausalLink): NodeKind {
  if (link.node_kind) return link.node_kind;
  if ((link.level ?? 1) >= 2 || (Array.isArray(link.members) && link.members.length === 2)) return "composite";
  const hasEffect = typeof (link.effect_anchor_index ?? link.consequence_anchor_index) === "number";
  const isClaimed = link.claimed === true;
  return hasEffect && isClaimed ? "link" : "singleton";
}

export function withInferredNodeKind(link: CausalLink): CausalLink {
  if (link.node_kind) return link;
  return {
    ...link,
    node_kind: inferNodeKind(link),
  };
}
