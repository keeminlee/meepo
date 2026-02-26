import { expect, test } from "vitest";
import { segmentTranscriptLines } from "../../tools/megameecap/segmenter.js";
import type { TranscriptLine } from "../../tools/megameecap/types.js";

function makeLines(count: number): TranscriptLine[] {
  return Array.from({ length: count }, (_, index) => ({
    lineIndex: index,
    speaker: index % 2 === 0 ? "DM" : "Player",
    text: `Line ${index}`,
  }));
}

test("segmenter is deterministic and creates stable IDs", () => {
  const lines = makeLines(7);
  const first = segmentTranscriptLines(lines, 3);
  const second = segmentTranscriptLines(lines, 3);

  expect(first).toEqual(second);
  expect(first.map((item) => item.segmentId)).toEqual(["SEG_0001", "SEG_0002", "SEG_0003"]);
});

test("segmenter partitions without overlap or gaps", () => {
  const lines = makeLines(10);
  const segments = segmentTranscriptLines(lines, 4);
  const flattened = segments.flatMap((segment) => segment.lines.map((line) => line.lineIndex));

  expect(flattened).toEqual(lines.map((line) => line.lineIndex));
  expect(segments[0]).toMatchObject({ startLine: 0, endLine: 3 });
  expect(segments[1]).toMatchObject({ startLine: 4, endLine: 7 });
  expect(segments[2]).toMatchObject({ startLine: 8, endLine: 9 });
});
