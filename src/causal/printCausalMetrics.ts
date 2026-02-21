import type { CyclePhaseState, MetricStats } from "./cycleTypes.js";

function fmtStats(stats: MetricStats | undefined): string {
  if (!stats) return "n/a";
  return `p50=${stats.p50.toFixed(2)} p90=${stats.p90.toFixed(2)} max=${stats.max.toFixed(2)}`;
}

export function printCausalMetrics(phases: CyclePhaseState[], opts?: { indent?: string }): void {
  const indent = opts?.indent ?? "  ";
  const byCycle = new Map<number, CyclePhaseState[]>();
  for (const phase of phases) {
    const arr = byCycle.get(phase.cycle) ?? [];
    arr.push(phase);
    byCycle.set(phase.cycle, arr);
  }

  for (const [cycle, states] of Array.from(byCycle.entries()).sort((a, b) => a[0] - b[0])) {
    console.log(`${indent}Cycle ${cycle}`);
    for (const state of states) {
      const label = state.phase === "link" ? "LINK" : "ANNEAL";
      console.log(`${indent}${indent}${label}: ${state.metrics.label}`);
      for (const [key, value] of Object.entries(state.metrics.counts)) {
        console.log(`${indent}${indent}${indent}${key}: ${value}`);
      }
      for (const [key, value] of Object.entries(state.metrics.stats)) {
        console.log(`${indent}${indent}${indent}${key} ${fmtStats(value)}`);
      }
    }
  }
}
