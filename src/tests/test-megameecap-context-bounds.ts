import { expect, test } from "vitest";
import { clampContextTexts, buildWrappedSegmentTranscript } from "../tools/meecaps/megameecapCore.js";

test("megameecap context obeys segment-count and char caps", () => {
  const prior = [
    "Segment 1 meecap.",
    "Segment 2 meecap with more detail.",
    "Segment 3 meecap with even more detail and continuity.",
    "Segment 4 meecap final.",
  ];

  const clamped = clampContextTexts(prior, 2, 40);

  expect(clamped.length).toBeLessThanOrEqual(2);
  expect(clamped.join("\n\n").length).toBeLessThanOrEqual(40);

  const wrapped = buildWrappedSegmentTranscript({
    contextTexts: clamped,
    currentSegmentText: "[L10] DM: Current segment content.",
  });

  expect(wrapped.contextCharsUsed).toBeLessThanOrEqual(40);
  expect(wrapped.wrappedTranscript).toContain("PRIOR CONTEXT");
  expect(wrapped.wrappedTranscript).toContain("CURRENT SEGMENT TRANSCRIPT");
  expect(wrapped.wrappedTranscript).toContain("Do not invent events");
});
