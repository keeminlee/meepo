import type { CausalLink } from "./types.js";

export function propagateInternalStrength(nodes: CausalLink[], childMap: Map<string, CausalLink>): void {
  for (const node of nodes) {
    if (!node.members || node.members.length !== 2) continue;
    const [leftId, rightId] = node.members;
    const left = childMap.get(leftId);
    const right = childMap.get(rightId);
    if (!left || !right) continue;
    const leftInternal = left.strength_internal ?? left.strength_bridge ?? left.strength_ce ?? left.score ?? 0;
    const rightInternal = right.strength_internal ?? right.strength_bridge ?? right.strength_ce ?? right.score ?? 0;
    node.strength_internal = (node.strength_internal ?? node.strength_bridge ?? 0) + leftInternal + rightInternal;
  }
}
