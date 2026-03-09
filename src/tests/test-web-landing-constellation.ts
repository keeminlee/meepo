// @ts-nocheck
import { describe, expect, test } from "vitest";
import { buildConstellationModel } from "../../apps/web/components/landing/landing-page";

describe("landing constellation helper", () => {
  test("marks current-user sessions and builds in-campaign links", () => {
    const model = buildConstellationModel({
      campaigns: [
        {
          slug: "alpha",
          name: "Alpha",
          sessions: [
            { id: "a1", title: "A1", date: "2026-01-01", startedByUserId: "dm-1" },
            { id: "a2", title: "A2", date: "2026-01-02", startedByUserId: "u-1" },
          ],
        },
        {
          slug: "beta",
          name: "Beta",
          sessions: [{ id: "b1", title: "B1", date: "2026-01-03", startedByUserId: "u-2" }],
        },
      ],
      currentUserId: "u-1",
    });

    expect(model.stars.length).toBe(3);
    expect(model.stars.find((star) => star.id === "a2")?.isUserSession).toBe(true);
    expect(model.stars.find((star) => star.id === "a1")?.isUserSession).toBe(false);
    expect(model.lines).toEqual([{ fromId: "a1", toId: "a2" }]);
  });

  test("caps star count at 36 and keeps positions in viewport bounds", () => {
    const sessions = Array.from({ length: 40 }, (_, index) => ({
      id: `s-${index + 1}`,
      title: `Session ${index + 1}`,
      date: `2026-02-${String((index % 28) + 1).padStart(2, "0")}`,
      startedByUserId: null,
    }));

    const model = buildConstellationModel({
      campaigns: [{ slug: "omega", name: "Omega", sessions }],
      currentUserId: null,
    });

    expect(model.stars.length).toBe(36);
    expect(model.stars.every((star) => star.x >= 0 && star.x <= 100)).toBe(true);
    expect(model.stars.every((star) => star.y >= 0 && star.y <= 100)).toBe(true);
    expect(model.lines.length).toBe(35);
  });
});