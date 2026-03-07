import { describe, expect, test, vi } from "vitest";

import {
  AWAKEN_CONTINUE_CUSTOM_ID_PREFIX,
  buildContinueCustomId,
  parseContinueCustomId,
} from "../awakening/prompts/continuePrompt.js";

process.env.DISCORD_TOKEN ??= "test-token";
process.env.OPENAI_API_KEY ??= "test-openai-key";

describe("awaken continue custom_id", () => {
  test("builds compact nonce-only continue custom_id", () => {
    const customId = buildContinueCustomId({ nonce: "n-123" });
    expect(customId).toBe(`${AWAKEN_CONTINUE_CUSTOM_ID_PREFIX}:n-123`);
    expect(customId.length).toBeLessThan(100);
  });

  test("parses legacy and compact continue custom_id formats", () => {
    const compact = `${AWAKEN_CONTINUE_CUSTOM_ID_PREFIX}:nonce-compact`;
    const legacy = `${AWAKEN_CONTINUE_CUSTOM_ID_PREFIX}:guild-1:meepo_awaken:scene-a:nonce-legacy`;

    expect(parseContinueCustomId(compact)).toEqual({ nonce: "nonce-compact" });
    expect(parseContinueCustomId(legacy)).toEqual({ nonce: "nonce-legacy" });
  });

  test("resume rendering succeeds even with long guild/script identifiers", async () => {
    const mod = await import("../awakening/prompts/index.js");
    const renderPendingAwakeningPrompt = mod.renderPendingAwakeningPrompt;

    const reply = vi.fn(async (_payload: unknown) => undefined);
    const interaction = {
      replied: false,
      deferred: false,
      reply,
      editReply: vi.fn(async (_payload: unknown) => undefined),
      followUp: vi.fn(async (_payload: unknown) => undefined),
    } as any;

    const script = {
      id: "meepo_awaken",
      version: 2,
      start_scene: "choose_mode",
      scenes: {
        choose_mode: {
          say: "continue",
        },
      },
    } as any;

    const state = {
      guild_id: "g".repeat(80),
      script_id: "onboarding-" + "x".repeat(120),
      script_version: 2,
      current_scene: "choose_mode",
      beat_index: 0,
      completed: false,
      progress_json: {},
      updated_at_ms: Date.now(),
    } as any;

    const rendered = await renderPendingAwakeningPrompt({
      interaction,
      script,
      state,
      originBranch: "resume",
      pending: {
        kind: "continue",
        key: "__continue__",
        sceneId: "choose_mode",
        nonce: "nonce-continue",
      },
    });

    expect(rendered).toBe(true);
    expect(reply).toHaveBeenCalledTimes(1);

    const payload = reply.mock.calls[0]?.[0] as any;
    const row = payload?.components?.[0];
    const rowJson = typeof row?.toJSON === "function" ? row.toJSON() : row;
    const customId = rowJson?.components?.[0]?.custom_id;
    expect(typeof customId).toBe("string");
    expect(customId.length).toBeLessThan(100);
  });
});
