import { describe, expect, it } from "vitest";
import { replayEvents } from "@/lib/starstory/replay";
import { createInitialNarrativeState } from "@/lib/starstory/types";
import { buildHappyPathEvents } from "@/lib/starstory/__tests__/testUtils";

describe("replayEvents", () => {
  it("replays accepted events into the same snapshot", () => {
    const initialState = createInitialNarrativeState(0);
    const state = replayEvents(buildHappyPathEvents(), initialState);

    expect(state.phase).toBe("STAR_BORN");
    expect(state.id).toBe("star-1");
    expect(state.transcriptLineCount).toBe(150);
    expect(state.validationStatus).toBe("passed");
  });

  it("starts from the explicit initial state when the log is empty", () => {
    const initialState = createInitialNarrativeState(42);
    const state = replayEvents([], initialState);

    expect(state).toEqual(initialState);
  });
});