import { describe, expect, test, vi } from "vitest";

process.env.DISCORD_TOKEN ??= "test-token";
process.env.OPENAI_API_KEY ??= "test-openai-key";

async function getRenderer() {
  const mod = await import("../prompts/index.js");
  return mod.renderPendingAwakeningPrompt;
}

describe("registry_builder resume", () => {
  test("re-renders user-select step when _rb_pending_character_name exists", async () => {
    const renderPendingAwakeningPrompt = await getRenderer();
    const reply = vi.fn(async (_payload: unknown) => undefined);
    const interaction = {
      replied: false,
      deferred: false,
      guild: {
        members: {
          cache: new Map([
            ["u1", { id: "u1", displayName: "Player One", user: { username: "PlayerOne" } }],
          ]),
        },
      },
      reply,
      editReply: vi.fn(async (_payload: unknown) => undefined),
    } as any;

    const script = {
      id: "meepo_awaken",
      version: 2,
      start_scene: "player_registry",
      scenes: {
        player_registry: {
          prompt: {
            type: "registry_builder",
            key: "players",
            label: "Add each player and character",
          },
        },
      },
    } as any;

    const state = {
      guild_id: "guild-1",
      script_id: "meepo_awaken",
      script_version: 2,
      current_scene: "player_registry",
      beat_index: 0,
      completed: false,
      progress_json: {
        players: [],
        _rb_pending_character_name: "Arin",
      },
      updated_at_ms: Date.now(),
    };

    const rendered = await renderPendingAwakeningPrompt({
      interaction,
      script,
      state: state as any,
      originBranch: "resume",
      pending: {
        kind: "registry_builder",
        key: "players",
        sceneId: "player_registry",
        nonce: "nonce-1",
      },
    });

    expect(rendered).toBe(true);
    expect(reply).toHaveBeenCalledTimes(1);
    const payload = reply.mock.calls[0]?.[0] as { content?: string };
    expect(payload.content).toContain("Assign character \"Arin\" to a player.");
  });

  test("uses editReply when interaction is deferred", async () => {
    const renderPendingAwakeningPrompt = await getRenderer();
    const reply = vi.fn(async (_payload: unknown) => undefined);
    const editReply = vi.fn(async (_payload: unknown) => undefined);
    const interaction = {
      replied: false,
      deferred: true,
      reply,
      editReply,
      followUp: vi.fn(async (_payload: unknown) => undefined),
    } as any;

    const script = {
      id: "meepo_awaken",
      version: 2,
      start_scene: "pick_mode",
      scenes: {
        pick_mode: {
          prompt: {
            type: "choice",
            key: "voice_mode",
            label: "Choose mode",
            options: [{ value: "voice", label: "Voice" }],
          },
        },
      },
    } as any;

    const state = {
      guild_id: "guild-1",
      script_id: "meepo_awaken",
      script_version: 2,
      current_scene: "pick_mode",
      beat_index: 0,
      completed: false,
      progress_json: {},
      updated_at_ms: Date.now(),
    };

    const rendered = await renderPendingAwakeningPrompt({
      interaction,
      script,
      state: state as any,
      originBranch: "initial_prompt",
      pending: {
        kind: "choice",
        key: "voice_mode",
        sceneId: "pick_mode",
        nonce: "nonce-2",
      },
    });

    expect(rendered).toBe(true);
    expect(editReply).toHaveBeenCalledTimes(1);
    expect(reply).not.toHaveBeenCalled();
  });

  test("uses followUp when interaction is already replied", async () => {
    const renderPendingAwakeningPrompt = await getRenderer();
    const reply = vi.fn(async (_payload: unknown) => undefined);
    const followUp = vi.fn(async (_payload: unknown) => undefined);
    const interaction = {
      replied: true,
      deferred: false,
      reply,
      editReply: vi.fn(async (_payload: unknown) => undefined),
      followUp,
    } as any;

    const script = {
      id: "meepo_awaken",
      version: 2,
      start_scene: "pick_mode",
      scenes: {
        pick_mode: {
          prompt: {
            type: "choice",
            key: "voice_mode",
            label: "Choose mode",
            options: [{ value: "voice", label: "Voice" }],
          },
        },
      },
    } as any;

    const state = {
      guild_id: "guild-1",
      script_id: "meepo_awaken",
      script_version: 2,
      current_scene: "pick_mode",
      beat_index: 0,
      completed: false,
      progress_json: {},
      updated_at_ms: Date.now(),
    };

    const rendered = await renderPendingAwakeningPrompt({
      interaction,
      script,
      state: state as any,
      originBranch: "resume",
      pending: {
        kind: "choice",
        key: "voice_mode",
        sceneId: "pick_mode",
        nonce: "nonce-3",
      },
    });

    expect(rendered).toBe(true);
    expect(followUp).toHaveBeenCalledTimes(1);
    expect(reply).not.toHaveBeenCalled();
  });

  test("falls back to followUp when deferred editReply is not valid at runtime", async () => {
    const renderPendingAwakeningPrompt = await getRenderer();
    const editReply = vi.fn(async () => {
      throw new Error("The reply to this interaction has not been sent or deferred.");
    });
    const followUp = vi.fn(async (_payload: unknown) => undefined);
    const interaction = {
      replied: false,
      deferred: true,
      reply: vi.fn(async () => {
        throw new Error("This interaction has already been acknowledged.");
      }),
      editReply,
      followUp,
    } as any;

    const script = {
      id: "meepo_awaken",
      version: 2,
      start_scene: "pick_mode",
      scenes: {
        pick_mode: {
          prompt: {
            type: "choice",
            key: "voice_mode",
            label: "Choose mode",
            options: [{ value: "voice", label: "Voice" }],
          },
        },
      },
    } as any;

    const state = {
      guild_id: "guild-1",
      script_id: "meepo_awaken",
      script_version: 2,
      current_scene: "pick_mode",
      beat_index: 0,
      completed: false,
      progress_json: {},
      updated_at_ms: Date.now(),
    };

    const rendered = await renderPendingAwakeningPrompt({
      interaction,
      script,
      state: state as any,
      originBranch: "initial_prompt",
      pending: {
        kind: "choice",
        key: "voice_mode",
        sceneId: "pick_mode",
        nonce: "nonce-fallback",
      },
    });

    expect(rendered).toBe(true);
    expect(editReply).toHaveBeenCalledTimes(1);
    expect(followUp).toHaveBeenCalledTimes(1);
  });
});
