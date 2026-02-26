import type { TranscriptEntry } from "../transcripts.js";

export function buildEligibleExcerpt(
  lines: TranscriptEntry[],
  startIndex: number,
  endIndex: number,
  eligibleInclude: boolean[],
  maxLines: number,
): { excerptText: string; excerptLineIndices: number[] } {
  const safeStart = Math.max(0, startIndex);
  const safeEnd = Math.min(endIndex, lines.length - 1);
  const cap = Math.max(1, Math.floor(maxLines));

  const picked: TranscriptEntry[] = [];
  const pickedIdx: number[] = [];

  for (let i = safeStart; i <= safeEnd; i++) {
    if (!eligibleInclude[i]) continue;
    const line = lines[i];
    if (!line) continue;

    picked.push(line);
    pickedIdx.push(i);

    if (picked.length >= cap) break;
  }

  const excerptText = picked
    .map((line) => {
      const t = new Date(line.timestamp_ms).toISOString();
      return `[${line.line_index}] [${t}] ${line.author_name}: ${line.content}`;
    })
    .join("\n");

  return {
    excerptText,
    excerptLineIndices: pickedIdx,
  };
}
