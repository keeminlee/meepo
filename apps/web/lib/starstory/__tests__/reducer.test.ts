import { describe, expect, it } from "vitest";
import type { NarrativeEvent } from "@/lib/starstory/events";
import { reduceNarrativeState } from "@/lib/starstory/reducer";
import { createInitialNarrativeState } from "@/lib/starstory/types";
import { buildHappyPathEvents } from "@/lib/starstory/__tests__/testUtils";

describe("reduceNarrativeState", () => {
  it("accepts the happy path and ends in STAR_BORN", () => {
    let state = createInitialNarrativeState(0);

    for (const event of buildHappyPathEvents()) {
      const result = reduceNarrativeState(state, event);
      expect(result.accepted).toBe(true);
      state = result.state;
    }

    expect(state.phase).toBe("STAR_BORN");
    expect(state.validationStatus).toBe("passed");
    expect(state.isInstalled).toBe(true);
    expect(state.isAwakened).toBe(true);
  });

  it("accepts the collapse path and ends in STAR_COLLAPSED", () => {
    const events: NarrativeEvent[] = [
      { type: "PROTO_STAR_SPAWNED", at: 1, starId: "star-1" },
      { type: "PROTO_STAR_CLICKED", at: 2 },
      { type: "PROTO_STAR_CLICKED", at: 3 },
      { type: "PROTO_STAR_CLICKED", at: 4 },
      { type: "PROTO_STAR_CLICKED", at: 5 },
      { type: "PROTO_STAR_CLICKED", at: 6 },
      { type: "CHRONICLE_STARTED", at: 7, campaignName: "Open Alpha" },
      { type: "DISCORD_INSTALL_COMPLETED", at: 8, guildId: "guild-1" },
      { type: "AWAKENING_COMPLETED", at: 9 },
      { type: "TRANSCRIPT_UPDATED", at: 10, transcriptLineCount: 20 },
      { type: "VALIDATION_STARTED", at: 11 },
      { type: "CHRONICLE_REJECTED", at: 12, reason: "too-short" },
    ];

    let state = createInitialNarrativeState(0);
    for (const event of events) {
      const result = reduceNarrativeState(state, event);
      expect(result.accepted).toBe(true);
      state = result.state;
    }

    expect(state.phase).toBe("STAR_COLLAPSED");
    expect(state.validationStatus).toBe("failed");
  });

  it("rejects illegal transitions and keeps state unchanged", () => {
    const state = createInitialNarrativeState(0);
    const result = reduceNarrativeState(state, { type: "VALIDATION_STARTED", at: 1 });

    expect(result.accepted).toBe(false);
    expect(result.state).toEqual(state);
  });

  it("rejects duplicate chronicle starts", () => {
    let state = createInitialNarrativeState(0);
    const setup: NarrativeEvent[] = [
      { type: "PROTO_STAR_SPAWNED", at: 1, starId: "star-1" },
      { type: "PROTO_STAR_CLICKED", at: 2 },
      { type: "PROTO_STAR_CLICKED", at: 3 },
      { type: "PROTO_STAR_CLICKED", at: 4 },
      { type: "PROTO_STAR_CLICKED", at: 5 },
      { type: "PROTO_STAR_CLICKED", at: 6 },
    ];

    for (const event of setup) {
      const result = reduceNarrativeState(state, event);
      state = result.state;
    }

    const first = reduceNarrativeState(state, {
      type: "CHRONICLE_STARTED",
      at: 7,
      campaignName: "Open Alpha",
    });
    expect(first.accepted).toBe(true);

    const second = reduceNarrativeState(first.state, {
      type: "CHRONICLE_STARTED",
      at: 8,
      campaignName: "Open Alpha Again",
    });

    expect(second.accepted).toBe(false);
    expect(second.state).toEqual(first.state);
  });

  it("rejects click spam once the proto-star is active", () => {
    let state = createInitialNarrativeState(0);
    const setup: NarrativeEvent[] = [
      { type: "PROTO_STAR_SPAWNED", at: 1, starId: "star-1" },
      { type: "PROTO_STAR_CLICKED", at: 2 },
      { type: "PROTO_STAR_CLICKED", at: 3 },
      { type: "PROTO_STAR_CLICKED", at: 4 },
      { type: "PROTO_STAR_CLICKED", at: 5 },
      { type: "PROTO_STAR_CLICKED", at: 6 },
    ];

    for (const event of setup) {
      const result = reduceNarrativeState(state, event);
      state = result.state;
    }

    const spam = reduceNarrativeState(state, { type: "PROTO_STAR_CLICKED", at: 7 });
    expect(spam.accepted).toBe(false);
    expect(spam.state).toEqual(state);
  });
});