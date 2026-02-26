import type { CarryBlock, CarryConfig, CarrySummary } from "./types.js";

function estimateChars(summaries: CarrySummary[]): number {
  return summaries.reduce((sum, item) => sum + item.summary.length, 0);
}

export function applyCarryBounds(
  summaries: CarrySummary[],
  config: CarryConfig,
): CarrySummary[] {
  const maxCarrySegments = Math.max(0, Math.floor(config.maxCarrySegments));
  const maxCarryChars = Math.max(0, Math.floor(config.maxCarryChars));

  if (maxCarrySegments === 0 || maxCarryChars === 0 || summaries.length === 0) {
    return [];
  }

  const bounded = summaries
    .slice(Math.max(0, summaries.length - maxCarrySegments))
    .map((entry) => ({ ...entry }));

  while (bounded.length > 0 && estimateChars(bounded) > maxCarryChars) {
    if (bounded.length > 1) {
      bounded.shift();
      continue;
    }

    const only = bounded[0]!;
    const overflow = estimateChars(bounded) - maxCarryChars;
    if (overflow <= 0) break;

    only.summary = only.summary.slice(Math.min(only.summary.length, overflow));
    if (!only.summary.trim()) {
      bounded.shift();
    }
  }

  return bounded;
}

export function buildCarryBlock(
  summaries: CarrySummary[],
  config: CarryConfig,
): CarryBlock {
  const bounded = applyCarryBounds(summaries, config);

  if (bounded.length === 0) {
    return {
      text: "PRIOR CONTEXT (most recent segments; may be incomplete)\n- (none)",
      usedChars: 0,
      summaries: [],
    };
  }

  const text = [
    "PRIOR CONTEXT (most recent segments; may be incomplete)",
    ...bounded.map((entry) => `- ${entry.segmentId}:\n${entry.summary}`),
  ].join("\n\n");

  return {
    text,
    usedChars: estimateChars(bounded),
    summaries: bounded,
  };
}

export function pushCarrySummary(
  existing: CarrySummary[],
  next: CarrySummary,
): CarrySummary[] {
  return [...existing, next];
}
