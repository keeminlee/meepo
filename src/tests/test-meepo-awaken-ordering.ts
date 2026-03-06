import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { InteractionType } from "discord.js";
import { afterEach, describe, expect, test, vi } from "vitest";

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
  getGuildConfig: vi.fn(() => ({ campaign_slug: "default" })),
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
    expect(interaction.followUp).toHaveBeenCalledTimes(3);
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(interaction.showModal).not.toHaveBeenCalled();

    const deferOrder = deferReply.mock.invocationCallOrder[0]!;
    const firstFollowUpOrder = interaction.followUp.mock.invocationCallOrder[0]!;
    const continueFollowUpOrder = interaction.followUp.mock.invocationCallOrder[2]!;

    expect(deferOrder).toBeLessThan(firstFollowUpOrder);
    expect(firstFollowUpOrder).toBeLessThan(continueFollowUpOrder);

    db.close();
  });
});
