import type { ScoredBeat } from "./findRelevantBeats.js";
import type { TranscriptLineResult } from "../ledger/transcripts.js";

export interface BuildMemoryContextOptions {
  maxLinesPerBeat?: number;  // Default: 2
  maxTotalChars?: number;     // Default: 1600
}

/**
 * Build "Memory Capsules" for prompt injection.
 * 
 * Formats scored beats with evidence transcript lines into a compact block:
 * 
 * === PARTY MEMORY (EVIDENCE) ===
 * [Beat] <beat.text>
 * Evidence: L39, L40, L41
 * - [L39] ...
 * - [L40] ...
 * 
 * @param beats Scored beats from findRelevantBeats
 * @param transcriptLines Pre-fetched transcript lines (all lines needed across beats)
 * @param opts Limits for evidence lines per beat and total char budget
 * @returns Formatted memory context block ready for prompt injection
 */
export function buildMemoryContext(
  beats: ScoredBeat[],
  transcriptLines: TranscriptLineResult[],
  opts?: BuildMemoryContextOptions
): string {
  const maxLinesPerBeat = opts?.maxLinesPerBeat ?? 2;
  const maxTotalChars = opts?.maxTotalChars ?? 1600;

  if (beats.length === 0) {
    return "";
  }

  // Build lookup map for transcript lines
  const lineMap = new Map<number, string>();
  for (const line of transcriptLines) {
    lineMap.set(line.line, line.text);
  }

  const sections: string[] = [];
  sections.push("=== PARTY MEMORY (EVIDENCE) ===");

  let currentLength = sections[0].length;

  for (const scored of beats) {
    const beatLines: string[] = [];

    // Beat text
    beatLines.push(`[Beat] ${scored.beat.text}`);

    // Evidence line numbers (sorted)
    const evidenceLineNums = scored.beat.lines.slice().sort((a, b) => a - b);
    const evidenceNumsStr = evidenceLineNums.map((n) => `L${n}`).join(", ");
    beatLines.push(`Evidence: ${evidenceNumsStr}`);

    // Fetch and show limited transcript lines
    const availableLines: { lineNum: number; text: string }[] = [];
    for (const lineNum of evidenceLineNums) {
      const text = lineMap.get(lineNum);
      if (text) {
        availableLines.push({ lineNum, text });
      }
    }

    // Limit to maxLinesPerBeat
    const linesToShow = availableLines.slice(0, maxLinesPerBeat);
    for (const { text } of linesToShow) {
      beatLines.push(`- ${text}`);
    }

    // Check if adding this beat would exceed total char limit
    const beatBlock = beatLines.join("\n");
    const newLength = currentLength + beatBlock.length + 2; // +2 for separator newlines

    if (newLength > maxTotalChars && sections.length > 1) {
      // Skip this beat to stay under budget
      break;
    }

    sections.push(beatBlock);
    currentLength = newLength;
  }

  // Append witness posture guidance
  sections.push(`WITNESS POSTURE (activate when evidence is provided):

You are responding using shared party memories that have been placed above.

- These are moments Meepo saw from afar with the Wanderer.
- Some memories may feel hazy or incomplete.
- If memory is thin, uncertain, or fragmentary, say so gently.
- Do not invent details that are not in the provided memories.
- Speak from a shared party perspective ("you were there", "in the waiting room", etc.).
- If helpful and simple, you may reference moments by scene or line hint (e.g., "in the waiting room") but avoid sounding like a narrator.
- Keep tone soft and uncertain.
- If you are unsure, admit uncertainty rather than filling gaps.

Pre-embodiment memories may feel dreamlike.
Post-embodiment memories feel clearer.
Reflect that difference naturally if relevant.`);

  return sections.join("\n\n");
}
