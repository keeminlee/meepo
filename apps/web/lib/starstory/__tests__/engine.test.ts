import { describe, expect, it } from "vitest";
import { createNarrativeEngine } from "@/lib/starstory/engine";
import { createInitialNarrativeState } from "@/lib/starstory/types";
import { buildHappyPathEvents, MemoryStarStoryPort } from "@/lib/starstory/__tests__/testUtils";

describe("createNarrativeEngine", () => {
  it("appends only accepted events and rejects duplicates from the persisted log", () => {
    const port = new MemoryStarStoryPort();
    const engine = createNarrativeEngine(port);

    for (const event of buildHappyPathEvents().slice(0, 7)) {
      engine.dispatch(event);
    }

    const duplicate = engine.dispatch({
      type: "CHRONICLE_STARTED",
      at: 100,
      campaignName: "Duplicate",
    });

    expect(duplicate.phase).toBe("CHRONICLE_STARTED");
    expect(port.events).toHaveLength(7);
  });

  it("reconstructs from the accepted event log when the snapshot is missing", () => {
    const port = new MemoryStarStoryPort({
      snapshot: null,
      events: buildHappyPathEvents(),
    });

    const engine = createNarrativeEngine(port);

    expect(engine.getSnapshot().phase).toBe("STAR_BORN");
    expect(engine.getSnapshot().validationStatus).toBe("passed");
  });

  it("notifies subscribers after accepted changes", () => {
    const port = new MemoryStarStoryPort();
    const engine = createNarrativeEngine(port);
    const seen: string[] = [];

    const unsubscribe = engine.subscribe((state) => {
      seen.push(state.phase);
    });

    engine.dispatch({ type: "PROTO_STAR_SPAWNED", at: 1, starId: "star-1" });
    engine.dispatch({ type: "VALIDATION_STARTED", at: 2 });
    unsubscribe();

    expect(seen).toEqual(["PROTO_STAR_FORMING"]);
  });

  it("supports clearing the snapshot and rebuilding from the accepted log", () => {
    const port = new MemoryStarStoryPort({
      snapshot: null,
      events: buildHappyPathEvents(),
    });
    const engine = createNarrativeEngine(port);

    port.saveSnapshot(createInitialNarrativeState(999));
    const rebuilt = engine.clearSnapshotOnly();

    expect(rebuilt.phase).toBe("STAR_BORN");
    expect(port.snapshot?.phase).toBe("STAR_BORN");
  });

  it("supports clearing only the accepted event log while preserving the current snapshot", () => {
    const port = new MemoryStarStoryPort({
      snapshot: null,
      events: buildHappyPathEvents(),
    });
    const engine = createNarrativeEngine(port);

    const current = engine.getSnapshot();
    const preserved = engine.clearEventsOnly();

    expect(preserved).toEqual(current);
    expect(port.events).toEqual([]);
    expect(port.snapshot).toEqual(current);
  });

  it("supports resetting both snapshot and accepted event log", () => {
    const port = new MemoryStarStoryPort({
      snapshot: null,
      events: buildHappyPathEvents(),
    });
    const engine = createNarrativeEngine(port);

    const reset = engine.resetAll(500);

    expect(reset.phase).toBe("SKY_IDLE");
    expect(reset.createdAtMs).toBe(500);
    expect(port.events).toEqual([]);
    expect(port.snapshot).toEqual(reset);
  });
});