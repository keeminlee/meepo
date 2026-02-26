import type { Segment, TranscriptLine } from "./types.js";

export function segmentTranscriptLines(lines: TranscriptLine[], segmentSize: number = 250): Segment[] {
  const safeSegmentSize = Math.max(1, Math.floor(segmentSize));
  const segments: Segment[] = [];

  for (let start = 0; start < lines.length; start += safeSegmentSize) {
    const end = Math.min(lines.length - 1, start + safeSegmentSize - 1);
    const segmentLines = lines.slice(start, end + 1);
    const segmentNumber = segments.length + 1;

    segments.push({
      segmentId: `SEG_${String(segmentNumber).padStart(4, "0")}`,
      startLine: segmentLines[0]?.lineIndex ?? start,
      endLine: segmentLines[segmentLines.length - 1]?.lineIndex ?? end,
      lines: segmentLines,
    });
  }

  return segments;
}
