import { expect, test } from "vitest";
import { orchestrateMegaMeecap } from "../../tools/megameecap/orchestrate.js";
import type { LlmCallInput, TranscriptLine } from "../../tools/megameecap/types.js";

function makeLines(count: number): TranscriptLine[] {
  return Array.from({ length: count }, (_, index) => ({
    lineIndex: index,
    speaker: index % 2 === 0 ? "DM" : "Player",
    text: `Transcript line ${index}`,
  }));
}

test("orchestrator calls LLM in order and carries prior summaries", async () => {
  const calls: LlmCallInput[] = [];
  const outputs = [
    "segment-one summary",
    "segment-two summary",
    "segment-three summary",
    "final-balanced output",
  ];

  const result = await orchestrateMegaMeecap(
    {
      sessionLabel: "C2E20",
      campaign: "default",
      segmentSize: 2,
      maxLlmLines: 1,
      carryConfig: { maxCarryChars: 500, maxCarrySegments: 3 },
      style: "balanced",
      noFinalPass: false,
      model: "test-model",
      lines: makeLines(5),
    },
    {
      callLlm: async (input) => {
        calls.push(input);
        return outputs[calls.length - 1] ?? "unexpected";
      },
    },
  );

  expect(calls).toHaveLength(4);
  expect(calls[1]?.userPrompt).toContain("segment-one summary");
  expect(calls[2]?.userPrompt).toContain("segment-two summary");
  expect(result.segmentLogs.map((s) => s.linesSent)).toEqual([1, 1, 1]);
  expect(result.finalMarkdown).toContain("final-balanced output");
  expect(result.meta.segment_count).toBe(3);
  expect(result.meta.final_style).toBe("balanced");
});

test("orchestrator skips final pass when requested", async () => {
  const calls: LlmCallInput[] = [];

  const result = await orchestrateMegaMeecap(
    {
      sessionLabel: "C2E20",
      campaign: "default",
      segmentSize: 3,
      maxLlmLines: 3,
      carryConfig: { maxCarryChars: 500, maxCarrySegments: 2 },
      style: "concise",
      noFinalPass: true,
      model: "test-model",
      lines: makeLines(6),
    },
    {
      callLlm: async (input) => {
        calls.push(input);
        return "segment-summary";
      },
    },
  );

  expect(calls).toHaveLength(2);
  expect(result.finalMarkdown).toBeNull();
  expect(result.meta.final_style).toBeNull();
});
