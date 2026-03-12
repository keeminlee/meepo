import { describe, expect, it } from "vitest";
import { createNarrativeEngine } from "@/lib/starstory/domain/narrative";
import { handleDiscordInstallCompleted } from "@/lib/starstory/runtimeAdapters/discordInstallAdapter";
import { buildHappyPathEvents, MemoryStarStoryPort } from "@/lib/starstory/__tests__/testUtils";

describe("handleDiscordInstallCompleted", () => {
  it("dispatches the install-completed narrative event", () => {
    const port = new MemoryStarStoryPort();
    const engine = createNarrativeEngine(port);

    for (const event of buildHappyPathEvents().slice(0, 7)) {
      engine.dispatch(event);
    }

    const state = handleDiscordInstallCompleted(engine, "guild-1", 20);

    expect(state.phase).toBe("AWAKENING_READY");
    expect(state.guildId).toBe("guild-1");
    expect(port.events.at(-1)?.type).toBe("DISCORD_INSTALL_COMPLETED");
  });

  it("leaves state unchanged when the engine is in the wrong phase", () => {
    const port = new MemoryStarStoryPort();
    const engine = createNarrativeEngine(port);
    const before = engine.getSnapshot();

    const state = handleDiscordInstallCompleted(engine, "guild-1", 20);

    expect(state).toEqual(before);
    expect(port.events).toEqual([]);
  });
});
