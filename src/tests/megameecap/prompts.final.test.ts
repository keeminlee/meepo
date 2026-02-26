import { expect, test } from "vitest";
import { buildFinalBalancedPrompt } from "../../tools/megameecap/prompts/finalBalancedPrompt.js";
import { buildFinalConcisePrompt } from "../../tools/megameecap/prompts/finalConcisePrompt.js";
import { buildFinalDetailedPrompt } from "../../tools/megameecap/prompts/finalDetailedPrompt.js";

test("final prompts are style-distinct and grounded", () => {
  const baseline = "# MegaMeecap baseline";
  const detailed = buildFinalDetailedPrompt(baseline);
  const balanced = buildFinalBalancedPrompt(baseline);
  const concise = buildFinalConcisePrompt(baseline);

  expect(detailed.systemPrompt).toContain("~1200-2000 words");
  expect(balanced.systemPrompt).toContain("~600-1000 words");
  expect(concise.systemPrompt).toContain("under 400 words");

  expect(detailed.userPrompt).toContain(baseline);
  expect(balanced.userPrompt).toContain(baseline);
  expect(concise.userPrompt).toContain(baseline);

  expect(detailed.systemPrompt).toContain("Do not invent facts");
  expect(balanced.systemPrompt).toContain("Do not invent facts");
  expect(concise.systemPrompt).toContain("Do not invent facts");
});
