import type { Gptcap, GptcapBeat } from "../ledger/gptcapProvider.js";
import type { EventRow } from "../ledger/eventSearch.js";

/**
 * Event line target: either an EventRow with start_line/end_line,
 * explicit line numbers, or a range object.
 */
export type EventLineTarget = 
  | EventRow 
  | number[] 
  | { start: number; end: number };

export interface ScoredBeat {
  beat: GptcapBeat;
  beatIndex: number;
  score: number;
}

/**
 * Convert event line target to a set of line numbers.
 */
function toLineSet(target: EventLineTarget): Set<number> {
  const lines = new Set<number>();

  // EventRow with start_line/end_line
  if (typeof (target as any).start_line === "number" && typeof (target as any).end_line === "number") {
    const event = target as EventRow;
    const start = event.start_line!;
    const end = event.end_line!;
    const min = Math.min(start, end);
    const max = Math.max(start, end);
    for (let line = min; line <= max; line++) {
      lines.add(line);
    }
    return lines;
  }

  // Explicit line numbers
  if (Array.isArray(target)) {
    for (const line of target) {
      if (typeof line === "number" && Number.isInteger(line) && line >= 0) {
        lines.add(line);
      }
    }
    return lines;
  }

  // Range object
  if (typeof (target as any).start === "number" && typeof (target as any).end === "number") {
    const range = target as { start: number; end: number };
    const min = Math.min(range.start, range.end);
    const max = Math.max(range.start, range.end);
    for (let line = min; line <= max; line++) {
      lines.add(line);
    }
    return lines;
  }

  return lines;
}

/**
 * Calculate overlap score between beat lines and target lines.
 * Score = |beat.lines ∩ targetLines|
 */
function calculateOverlap(beatLines: number[], targetLines: Set<number>): number {
  let overlap = 0;
  for (const line of beatLines) {
    if (targetLines.has(line)) {
      overlap++;
    }
  }
  return overlap;
}

/**
 * Map events to relevant GPTcap beats via line overlap scoring.
 * 
 * For each event target:
 * - Identify target lines (from EventRow ranges or explicit line lists)
 * - Score each beat by overlap count: score = |beat.lines ∩ targetLines|
 * - Return top K beats across all events, deduped by beat index
 * 
 * @param gptcap GPTcap JSON with beats
 * @param targets Array of event line targets (EventRow, line numbers, or ranges)
 * @param opts Options including topK (default: 6)
 * @returns Top K scored beats, sorted by score descending
 */
export function findRelevantBeats(
  gptcap: Gptcap,
  targets: EventLineTarget[],
  opts?: { topK?: number }
): ScoredBeat[] {
  const topK = opts?.topK ?? 6;

  // Aggregate all target lines across all events
  const allTargetLines = new Set<number>();
  for (const target of targets) {
    const lineSet = toLineSet(target);
    for (const line of lineSet) {
      allTargetLines.add(line);
    }
  }

  if (allTargetLines.size === 0) {
    return [];
  }

  // Score each beat by overlap with target lines
  const scoredBeats: ScoredBeat[] = [];
  for (let i = 0; i < gptcap.beats.length; i++) {
    const beat = gptcap.beats[i];
    const score = calculateOverlap(beat.lines, allTargetLines);
    if (score > 0) {
      scoredBeats.push({
        beat,
        beatIndex: i,
        score,
      });
    }
  }

  // Sort by score descending, then by beat index ascending (stable)
  scoredBeats.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.beatIndex - b.beatIndex;
  });

  // Return top K, deduped by beat index (already deduped since we iterate once)
  return scoredBeats.slice(0, topK);
}
