import { classifyLineKind } from "./classifyLineKind.js";
import { computeSegmentationMetrics } from "./metrics.js";
import type {
  ClassifiedLine,
  CombatMode,
  Segment,
  SegmentationResult,
  SegmentTranscriptInput,
} from "./types.js";

function isCountedLine(kind: string, combatMode: CombatMode): boolean {
  if (kind === "narrative") return true;
  if (kind === "combat" && combatMode === "include") return true;
  return false;
}

function isIncludedLine(kind: string, combatMode: CombatMode): boolean {
  if (kind === "narrative") return true;
  if (kind === "combat" && (combatMode === "include" || combatMode === "include_not_counted")) {
    return true;
  }
  return false;
}

function clampInt(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

export function segmentTranscript(input: SegmentTranscriptInput): SegmentationResult {
  const combatMode: CombatMode = input.combatMode ?? "prune";
  const countAllLines = input.countAllLines ?? false;
  const targetNarrativeLines = clampInt(input.targetNarrativeLines, 250);
  const minNarrativeLines = clampInt(input.minNarrativeLines, Math.max(1, Math.floor(targetNarrativeLines * 0.8)));
  const maxNarrativeLines = clampInt(input.maxNarrativeLines, Math.max(minNarrativeLines, Math.ceil(targetNarrativeLines * 1.25)));
  const snapWindow = Math.max(0, Math.floor(input.snapWindow));

  const classifiedLines: ClassifiedLine[] = input.lines.map((line, index) => ({
    index,
    kind: classifyLineKind(line),
    line,
  }));

  const countedIndices = classifiedLines
    .filter((item) => (countAllLines ? true : isCountedLine(item.kind, combatMode)))
    .map((item) => item.index);

  const segments: Segment[] = [];
  let countedCursor = 0;

  while (countedCursor < countedIndices.length) {
    const startLineIndex = countedIndices[countedCursor];
    const localCountedIndices: number[] = [];

    for (let i = countedCursor; i < countedIndices.length; i++) {
      localCountedIndices.push(countedIndices[i]);
      if (localCountedIndices.length >= maxNarrativeLines) {
        break;
      }
    }

    const available = localCountedIndices.length;
    if (available === 0) {
      break;
    }

    const lowerBound = Math.min(minNarrativeLines, available);
    const upperBound = Math.min(maxNarrativeLines, available);
    const target = Math.min(Math.max(targetNarrativeLines, lowerBound), upperBound);

    const candidatePositions: number[] = [];
    for (let count = lowerBound; count <= upperBound; count++) {
      if (Math.abs(count - target) <= snapWindow || count === target || count === upperBound) {
        candidatePositions.push(count);
      }
    }

    const uniqueCandidates = Array.from(new Set(candidatePositions)).sort((a, b) => a - b);

    let selectedCount = upperBound;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const candidate of uniqueCandidates) {
      const distance = Math.abs(candidate - target);
      if (distance < bestDistance) {
        bestDistance = distance;
        selectedCount = candidate;
      }
    }

    const selectedCountedIndex = localCountedIndices[selectedCount - 1];

    let endLineIndex = selectedCountedIndex;
    if (combatMode === "include_not_counted") {
      for (let i = selectedCountedIndex + 1; i < classifiedLines.length; i++) {
        if (classifiedLines[i].kind === "combat") {
          endLineIndex = i;
          continue;
        }
        break;
      }
    }

    let narrativeLineCount = 0;
    for (let i = startLineIndex; i <= endLineIndex; i++) {
      if (countAllLines) {
        narrativeLineCount += 1;
        continue;
      }
      if (isCountedLine(classifiedLines[i].kind, combatMode)) {
        narrativeLineCount += 1;
      }
    }

    segments.push({
      id: `SEG_${String(segments.length + 1).padStart(4, "0")}`,
      startLineIndex,
      endLineIndex,
      narrativeLineCount,
      totalLineCount: endLineIndex - startLineIndex + 1,
    });

    countedCursor += selectedCount;

    while (countedCursor < countedIndices.length) {
      const nextIdx = countedIndices[countedCursor];
      if (!countAllLines && !isIncludedLine(classifiedLines[nextIdx].kind, combatMode)) {
        countedCursor += 1;
        continue;
      }
      if (nextIdx <= endLineIndex) {
        countedCursor += 1;
        continue;
      }
      break;
    }
  }

  const metrics = computeSegmentationMetrics(segments, classifiedLines);
  return { segments, metrics };
}
