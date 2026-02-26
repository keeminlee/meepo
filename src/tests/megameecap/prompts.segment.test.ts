import { expect, test } from "vitest";
import { buildSegmentPrompt } from "../../tools/megameecap/prompts/segmentPrompt.js";

test("segment prompt includes measurable constraints and anti-recap contract", () => {
  const prompt = buildSegmentPrompt({
    priorContext: "PRIOR CONTEXT\n- SEG_0001: prior summary",
    segmentHeader: "SEG_0002 — Lines 250-499",
    transcriptChunk: "[L250] DM: The vault door opens.",
  });

  expect(prompt.systemPrompt).toContain("Summarize ONLY the current segment");
  expect(prompt.systemPrompt).toContain("Do not use a SESSION RECAP section");
  expect(prompt.systemPrompt).toContain("Use 8-16 bullets max");
  expect(prompt.systemPrompt).toContain("Keep output under ~450 words");
  expect(prompt.userPrompt).toContain("PRIOR CONTEXT");
  expect(prompt.userPrompt).toContain("CURRENT SEGMENT TRANSCRIPT");
});
