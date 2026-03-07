import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { InteractionType } from "discord.js";
import { afterEach, describe, expect, test, vi } from "vitest";

let awakenedFlag = 0;
const renderPendingPromptSpy = vi.fn(async (...args: unknown[]) => {
  const actual = await vi.importActual<typeof import("../awakening/prompts/index.js")>("../awakening/prompts/index.js");
  return actual.renderPendingAwakeningPrompt(...(args as Parameters<typeof actual.renderPendingAwakeningPrompt>));
});

vi.mock("../awakening/prompts/index.js", async () => {
  const actual = await vi.importActual<typeof import("../awakening/prompts/index.js")>("../awakening/prompts/index.js");
  return {
    ...actual,
    renderPendingAwakeningPrompt: renderPendingPromptSpy,
  };
});

const runWakeMock = vi.fn(async (interaction: any) => {
  await interaction.followUp({ content: "scene-line-1", ephemeral: false });
  await interaction.followUp({ content: "scene-line-2", ephemeral: false });
  return {
    status: "blocked" as const,
    reason: "prompt" as const,
    sceneId: "ask_dm_name",
    emittedBeatCount: 2,
  };
});

vi.mock("../awakening/AwakenEngine.js", () => ({
  AwakenEngine: {
    runWake: runWakeMock,
  },
}));

vi.mock("../security/isElevated.js", () => ({
  isElevated: vi.fn(() => true),
}));

vi.mock("../scripts/awakening/_loader.js", () => ({
  loadAwakenScript: vi.fn(async () => ({
    id: "meepo_awaken",
    version: 2,
    start_scene: "ask_dm_name",
    scenes: {
      ask_dm_name: {
        prompt: {
          type: "modal_text",
          key: "dm_display_name",
          label: "Your name",
        },
      },
    },
  })),
}));

vi.mock("../campaign/guildConfig.js", () => ({
  getGuildCanonPersonaId: vi.fn(() => null),
  getGuildCanonPersonaMode: vi.fn(() => "meta"),
  getGuildConfig: vi.fn(() => ({ campaign_slug: "default", awakened: awakenedFlag })),
  getGuildDmUserId: vi.fn(() => "dm-user"),
  getGuildDefaultRecapStyle: vi.fn(() => "balanced"),
  getGuildHomeTextChannelId: vi.fn(() => null),
  getGuildHomeVoiceChannelId: vi.fn(() => null),
  getGuildSetupVersion: vi.fn(() => 1),
  resolveGuildHomeVoiceChannelId: vi.fn(() => null),
  setGuildCanonPersonaId: vi.fn(),
  setGuildCanonPersonaMode: vi.fn(),
  setGuildDefaultRecapStyle: vi.fn(),
  setGuildDmUserId: vi.fn(),
  setGuildHomeTextChannelId: vi.fn(),
  setGuildHomeVoiceChannelId: vi.fn(),
}));

const tempDirs: string[] = [];

function configureHermeticEnv(tempDir: string): void {
  vi.stubEnv("DATA_ROOT", tempDir);
  vi.stubEnv("DATA_CAMPAIGNS_DIR", "campaigns");
  vi.stubEnv("DATA_DB_FILENAME", "db.sqlite");
  vi.stubEnv("DISCORD_TOKEN", "test-token");
  vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
  vi.stubEnv("MIGRATIONS_SILENT", "1");
}

afterEach(() => {
  runWakeMock.mockClear();
  renderPendingPromptSpy.mockClear();
  awakenedFlag = 0;
  vi.unstubAllEnvs();
  vi.resetModules();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore cleanup races
      }
    }
  }
});

describe("/meepo awaken ordering", () => {
  test("defers before narration and posts continue after narration without showing modal", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-awaken-order-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const { meepo } = await import("../commands/meepo.js");
    const { getDbForCampaign } = await import("../db.js");
    const { initState, saveProgress } = await import("../ledger/awakeningStateRepo.js");

    const db = getDbForCampaign("default");
    initState("guild-1", "meepo_awaken", 2, "ask_dm_name", { db });
    saveProgress("guild-1", "meepo_awaken", {
      await_input: { key: "__continue__", kind: "continue" },
      pending_prompt_kind: "continue",
      pending_prompt_key: "__continue__",
      pending_prompt_scene_id: "ask_dm_name",
      pending_prompt_nonce: "nonce-1",
    }, { db });

    const interaction: any = {
      type: InteractionType.ApplicationCommand,
      guildId: "guild-1",
      channelId: "channel-1",
      guild: {},
      member: {},
      memberPermissions: { has: vi.fn(() => true) },
      user: { id: "dm-user", username: "DM" },
      deferred: false,
      replied: false,
      followUp: vi.fn(async () => undefined),
      editReply: vi.fn(async () => undefined),
      showModal: vi.fn(async () => undefined),
      reply: vi.fn(async () => undefined),
      options: {
        getSubcommandGroup: () => null,
        getSubcommand: () => "awaken",
        getString: () => null,
      },
    };

    const deferReply = vi.fn(async () => {
      interaction.deferred = true;
      return undefined;
    });
    interaction.deferReply = deferReply;

    await meepo.execute(interaction, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    expect(deferReply).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledTimes(2);
    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    expect(interaction.showModal).not.toHaveBeenCalled();
    expect(renderPendingPromptSpy).toHaveBeenCalledTimes(1);

    const firstRenderArgs = renderPendingPromptSpy.mock.calls[0]?.[0] as { originBranch?: string } | undefined;
    expect(firstRenderArgs?.originBranch).toBe("initial_prompt");

    const deferOrder = deferReply.mock.invocationCallOrder[0]!;
    const firstFollowUpOrder = interaction.followUp.mock.invocationCallOrder[0]!;
    const continuePromptOrder = interaction.editReply.mock.invocationCallOrder[0]!;

    expect(deferOrder).toBeLessThan(firstFollowUpOrder);
    expect(firstFollowUpOrder).toBeLessThan(continuePromptOrder);

    const allContents = [
      ...interaction.followUp.mock.calls.map((call: any[]) => String(call?.[0]?.content ?? "")),
      ...interaction.editReply.mock.calls.map((call: any[]) => String(call?.[0]?.content ?? call?.[0] ?? "")),
      ...interaction.reply.mock.calls.map((call: any[]) => String(call?.[0]?.content ?? "")),
    ].join("\n");
    expect(allContents).not.toContain("ERR_UNKNOWN");
    expect(allContents).not.toContain("[awaken-boundary-marker:global-v1]");

    db.close();
  });

  test("resets stale onboarding scene before run to avoid ERR_UNKNOWN", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-awaken-order-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const { meepo } = await import("../commands/meepo.js");
    const { getDbForCampaign } = await import("../db.js");
    const { initState, loadState } = await import("../ledger/awakeningStateRepo.js");

    const db = getDbForCampaign("default");
    initState("guild-1", "meepo_awaken", 1, "deleted_scene", { db });

    const interaction: any = {
      type: InteractionType.ApplicationCommand,
      guildId: "guild-1",
      channelId: "channel-1",
      guild: {},
      member: {},
      memberPermissions: { has: vi.fn(() => true) },
      user: { id: "dm-user", username: "DM" },
      deferred: false,
      replied: false,
      followUp: vi.fn(async () => undefined),
      editReply: vi.fn(async () => undefined),
      showModal: vi.fn(async () => undefined),
      reply: vi.fn(async () => undefined),
      options: {
        getSubcommandGroup: () => null,
        getSubcommand: () => "awaken",
        getString: () => null,
      },
    };

    const deferReply = vi.fn(async () => {
      interaction.deferred = true;
      return undefined;
    });
    interaction.deferReply = deferReply;

    await meepo.execute(interaction, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    const stateAfter = loadState("guild-1", "meepo_awaken", { db });
    expect(stateAfter?.current_scene).toBe("ask_dm_name");
    expect(runWakeMock).toHaveBeenCalled();

    db.close();
  });

  test("returns clear already-awakened guidance when guild awakened flag is set", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-awaken-order-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);
    awakenedFlag = 1;

    const { meepo } = await import("../commands/meepo.js");
    const { getDbForCampaign } = await import("../db.js");

    const db = getDbForCampaign("default");

    const interaction: any = {
      type: InteractionType.ApplicationCommand,
      guildId: "guild-1",
      channelId: "channel-1",
      guild: {},
      member: {},
      memberPermissions: { has: vi.fn(() => true) },
      user: { id: "dm-user", username: "DM" },
      deferred: false,
      replied: false,
      showModal: vi.fn(async () => undefined),
      reply: vi.fn(async () => undefined),
      options: {
        getSubcommandGroup: () => null,
        getSubcommand: () => "awaken",
        getString: () => null,
      },
    };

    await meepo.execute(interaction, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    expect(interaction.reply.mock.calls[0]?.[0]).toEqual({
      content: "Meepo is already awake in this world, meep. Use /lab awaken reset to run onboarding again.",
      ephemeral: true,
    });
    expect(runWakeMock).not.toHaveBeenCalled();
    expect(renderPendingPromptSpy).not.toHaveBeenCalled();

    db.close();
  });

  test("already-awakened branch responds safely when interaction is already deferred", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-awaken-order-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);
    awakenedFlag = 1;

    const { meepo } = await import("../commands/meepo.js");
    const { getDbForCampaign } = await import("../db.js");

    const db = getDbForCampaign("default");
    const interaction: any = {
      type: InteractionType.ApplicationCommand,
      guildId: "guild-1",
      channelId: "channel-1",
      guild: {},
      member: {},
      memberPermissions: { has: vi.fn(() => true) },
      user: { id: "dm-user", username: "DM" },
      deferred: true,
      replied: false,
      followUp: vi.fn(async () => undefined),
      editReply: vi.fn(async () => undefined),
      reply: vi.fn(async () => undefined),
      options: {
        getSubcommandGroup: () => null,
        getSubcommand: () => "awaken",
        getString: () => null,
      },
    };

    await meepo.execute(interaction, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.followUp).not.toHaveBeenCalled();
    expect(runWakeMock).not.toHaveBeenCalled();
    expect(renderPendingPromptSpy).not.toHaveBeenCalled();

    db.close();
  });

  test("already-awakened branch falls back to followUp when deferred editReply fails", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-awaken-order-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);
    awakenedFlag = 1;

    const { meepo } = await import("../commands/meepo.js");
    const { getDbForCampaign } = await import("../db.js");

    const db = getDbForCampaign("default");
    const interaction: any = {
      type: InteractionType.ApplicationCommand,
      guildId: "guild-1",
      channelId: "channel-1",
      guild: {},
      member: {},
      memberPermissions: { has: vi.fn(() => true) },
      user: { id: "dm-user", username: "DM" },
      deferred: true,
      replied: false,
      followUp: vi.fn(async () => undefined),
      editReply: vi.fn(async () => {
        throw new Error("The reply to this interaction has not been sent or deferred.");
      }),
      reply: vi.fn(async () => undefined),
      options: {
        getSubcommandGroup: () => null,
        getSubcommand: () => "awaken",
        getString: () => null,
      },
    };

    await meepo.execute(interaction, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledTimes(1);
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(runWakeMock).not.toHaveBeenCalled();
    expect(renderPendingPromptSpy).not.toHaveBeenCalled();

    db.close();
  });

  test("already-awakened branch uses followUp when interaction is already replied", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-awaken-order-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);
    awakenedFlag = 1;

    const { meepo } = await import("../commands/meepo.js");
    const { getDbForCampaign } = await import("../db.js");

    const db = getDbForCampaign("default");
    const interaction: any = {
      type: InteractionType.ApplicationCommand,
      guildId: "guild-1",
      channelId: "channel-1",
      guild: {},
      member: {},
      memberPermissions: { has: vi.fn(() => true) },
      user: { id: "dm-user", username: "DM" },
      deferred: false,
      replied: true,
      followUp: vi.fn(async () => undefined),
      editReply: vi.fn(async () => undefined),
      reply: vi.fn(async () => undefined),
      options: {
        getSubcommandGroup: () => null,
        getSubcommand: () => "awaken",
        getString: () => null,
      },
    };

    await meepo.execute(interaction, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    expect(interaction.followUp).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(renderPendingPromptSpy).not.toHaveBeenCalled();
    const content = String(interaction.followUp.mock.calls[0]?.[0]?.content ?? "");
    expect(content).not.toContain("ERR_AWAKEN_PROMPT");

    db.close();
  });

  test("returns awaken-specific error when initial engine step throws", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-awaken-order-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    runWakeMock.mockRejectedValueOnce(new Error("model bootstrap failed"));

    const { meepo } = await import("../commands/meepo.js");
    const { getDbForCampaign } = await import("../db.js");

    const db = getDbForCampaign("default");
    const interaction: any = {
      type: InteractionType.ApplicationCommand,
      guildId: "guild-1",
      channelId: "channel-1",
      guild: {},
      member: {},
      memberPermissions: { has: vi.fn(() => true) },
      user: { id: "dm-user", username: "DM" },
      deferred: false,
      replied: false,
      followUp: vi.fn(async () => undefined),
      editReply: vi.fn(async () => undefined),
      reply: vi.fn(async () => undefined),
      options: {
        getSubcommandGroup: () => null,
        getSubcommand: () => "awaken",
        getString: () => null,
      },
    };
    interaction.deferReply = vi.fn(async () => {
      interaction.deferred = true;
      return undefined;
    });

    await meepo.execute(interaction, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    const lastEditReply = interaction.editReply.mock.calls.at(-1)?.[0];
    const errorPayload = typeof lastEditReply === "string"
      ? lastEditReply
      : String(lastEditReply?.content ?? "");
    expect(errorPayload).toContain("ERR_AWAKEN_MODEL");
    expect(errorPayload).not.toContain("ERR_UNKNOWN");
    db.close();
  });
});
