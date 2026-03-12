import { describe, expect, it } from "vitest";
import { createNarrativeEngine } from "@/lib/starstory/domain/narrative";
import { handleChronicleRejected, handleChronicleValidated } from "@/lib/starstory/runtimeAdapters/validationAdapter";
import { buildHappyPathEvents, MemoryStarStoryPort } from "@/lib/starstory/__tests__/testUtils";

describe("validation adapters", () => {
  it("validates the chronicle when the threshold is met", () => {
    const port = new MemoryStarStoryPort();
    const engine = createNarrativeEngine(port);

    for (const event of buildHappyPathEvents().slice(0, 11)) {
      engine.dispatch(event);
    }

    const state = handleChronicleValidated(engine, 20);

    expect(state.phase).toBe("STAR_BORN");
    expect(state.validationStatus).toBe("passed");
  });

  it("can reject the chronicle from validation", () => {
    const port = new MemoryStarStoryPort();
    const engine = createNarrativeEngine(port);

    for (const event of buildHappyPathEvents().slice(0, 9)) {
      engine.dispatch(event);
    }
    engine.dispatch({ type: "TRANSCRIPT_UPDATED", at: 10, transcriptLineCount: 20 });
    engine.dispatch({ type: "VALIDATION_STARTED", at: 11 });

    const state = handleChronicleRejected(engine, "too-short", 20);

    expect(state.phase).toBe("AWAKENED");
    expect(state.validationStatus).toBe("failed");
  });
});
