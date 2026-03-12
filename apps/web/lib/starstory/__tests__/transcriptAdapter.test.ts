import { describe, expect, it } from "vitest";
import { createNarrativeEngine } from "@/lib/starstory/domain/narrative";
import { handleTranscriptUpdate } from "@/lib/starstory/runtimeAdapters/transcriptAdapter";
import { buildHappyPathEvents, MemoryStarStoryPort } from "@/lib/starstory/__tests__/testUtils";

describe("handleTranscriptUpdate", () => {
  it("dispatches transcript updates into the recording state", () => {
    const port = new MemoryStarStoryPort();
    const engine = createNarrativeEngine(port);

    for (const event of buildHappyPathEvents().slice(0, 9)) {
      engine.dispatch(event);
    }

    const state = handleTranscriptUpdate(engine, 150, 20);

    expect(state.phase).toBe("CHRONICLE_RECORDING");
    expect(state.transcriptLineCount).toBe(150);
    expect(port.events.at(-1)?.type).toBe("TRANSCRIPT_UPDATED");
  });

  it("does not append a transcript event before awakening", () => {
    const port = new MemoryStarStoryPort();
    const engine = createNarrativeEngine(port);

    const state = handleTranscriptUpdate(engine, 10, 20);

    expect(state.phase).toBe("SKY_IDLE");
    expect(port.events).toEqual([]);
  });
});
