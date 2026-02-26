import { expect, test } from "vitest";
import {
  applyCarryBounds,
  buildCarryBlock,
  pushCarrySummary,
} from "../../tools/megameecap/contextCarry.js";

test("carry bounds enforce both segment and char limits", () => {
  const summaries = [
    { segmentId: "SEG_0001", summary: "alpha-alpha-alpha" },
    { segmentId: "SEG_0002", summary: "beta-beta-beta" },
    { segmentId: "SEG_0003", summary: "gamma-gamma-gamma" },
  ];

  const bounded = applyCarryBounds(summaries, {
    maxCarrySegments: 2,
    maxCarryChars: 20,
  });

  expect(bounded.length).toBeLessThanOrEqual(2);
  expect(bounded.reduce((sum, item) => sum + item.summary.length, 0)).toBeLessThanOrEqual(20);
});

test("carry block keeps stable marker and push preserves order", () => {
  const pushed = pushCarrySummary([], { segmentId: "SEG_0001", summary: "first" });
  const pushedAgain = pushCarrySummary(pushed, { segmentId: "SEG_0002", summary: "second" });
  const block = buildCarryBlock(pushedAgain, {
    maxCarrySegments: 2,
    maxCarryChars: 200,
  });

  expect(block.text).toContain("PRIOR CONTEXT (most recent segments; may be incomplete)");
  expect(block.text).toContain("SEG_0001");
  expect(block.text).toContain("SEG_0002");
  expect(block.usedChars).toBeGreaterThan(0);
});
