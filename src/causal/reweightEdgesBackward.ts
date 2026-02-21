import type { CandidateEdge } from "./intentGraphTypes.js";

/**
 * @deprecated Legacy bipartite intent→consequence edge reweighting.
 * Link-centric neighborhood boosting in extractCausalLinksKernel is the primary path.
 */

function normalizeByKey(edges: CandidateEdge[], key: "intent_id" | "consequence_id"): Map<string, number> {
  const sums = new Map<string, number>();
  for (const edge of edges) {
    const groupKey = edge[key];
    sums.set(groupKey, (sums.get(groupKey) ?? 0) + edge.adjusted_score);
  }
  return sums;
}

export function reweightEdgesBackward(edges: CandidateEdge[], beta: number, iters: number): CandidateEdge[] {
  let current = edges.map((edge) => ({ ...edge }));

  for (let iter = 0; iter < iters; iter++) {
    const outSums = normalizeByKey(current, "intent_id");
    const inSums = normalizeByKey(current, "consequence_id");

    const outTop = new Map<string, number>();
    const inTop = new Map<string, number>();

    for (const edge of current) {
      const p = edge.adjusted_score / (outSums.get(edge.intent_id) ?? 1);
      const q = edge.adjusted_score / (inSums.get(edge.consequence_id) ?? 1);
      outTop.set(edge.intent_id, Math.max(outTop.get(edge.intent_id) ?? 0, p));
      inTop.set(edge.consequence_id, Math.max(inTop.get(edge.consequence_id) ?? 0, q));
    }

    current = current.map((edge) => {
      const p = edge.adjusted_score / (outSums.get(edge.intent_id) ?? 1);
      const q = edge.adjusted_score / (inSums.get(edge.consequence_id) ?? 1);
      const pTop = outTop.get(edge.intent_id) ?? 0;
      const qTop = inTop.get(edge.consequence_id) ?? 0;

      const isOutTop = Math.abs(p - pTop) < 1e-9;
      const isInTop = Math.abs(q - qTop) < 1e-9;

      const outPenalty = isOutTop ? 1 : Math.max(0.2, 1 - beta * pTop);
      const inPenalty = isInTop ? 1 : Math.max(0.2, 1 - beta * qTop);

      return {
        ...edge,
        adjusted_score: edge.base_score * outPenalty * inPenalty,
      };
    });
  }

  return current;
}
