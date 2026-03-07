import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

let configuredDmUserId: string | null = "dm-user";

const runWakeMock = vi.fn(async () => ({
  status: "blocked" as const,
  reason: "budget" as const,
  sceneId: "choose_mode",
  emittedBeatCount: 0,
}));

vi.mock("../awakening/AwakenEngine.js", () => ({
  AwakenEngine: {
    runWake: runWakeMock,
  },
}));

vi.mock("../security/isElevated.js", () => ({
  isElevated: vi.fn(() => true),
}));

vi.mock("../campaign/guildConfig.js", () => ({
  getGuildCanonPersonaId: vi.fn(() => null),
  getGuildCanonPersonaMode: vi.fn(() => "meta"),
  getGuildConfig: vi.fn(() => ({ campaign_slug: "default" })),
  getGuildDmRoleId: vi.fn(() => null),
  getGuildDmUserId: vi.fn(() => configuredDmUserId),
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

vi.mock("../scripts/awakening/_loader.js", () => ({
  loadAwakenScript: vi.fn(async () => ({
    id: "meepo_awaken",
    version: 2,
    start_scene: "choose_mode",
    scenes: {
      ask_dm_name: {
        prompt: {
          type: "modal_text",
          key: "dm_display_name",
          label: "Your name",
        },
        next: "done",
      },
      dm_role: {
        prompt: {
          type: "role_select",
          key: "dm_role_id",
          label: "Select DM role",
        },
        next: "done",
      },
      choose_mode: {
        prompt: {
          type: "choice",
          key: "voice_mode",
          label: "Choose mode",
          options: [
            { value: "voice", label: "Voice" },
            { value: "text", label: "Text" },
          ],
        },
        next: "done",
      },
      player_registry: {
        prompt: {
          type: "registry_builder",
          key: "players",
          label: "Build player registry",
          entry_schema: [
            { type: "user_select", key: "user_id", label: "Player" },
            { type: "text", key: "character_name", label: "Character name" },
          ],
        },
        next: "done",
      },
      done: {
        say: "done",
      },
    },
  })),
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

function buildButtonInteraction(args: { userId: string; customId: string; hasManageGuild?: boolean }) {
  const reply = vi.fn(async (_payload: { content: string; ephemeral: boolean }) => undefined);
  const editReply = vi.fn(async (_payload: { content: string; ephemeral?: boolean }) => undefined);
  const followUp = vi.fn(async (_payload: { content: string; ephemeral: boolean }) => undefined);
  return {
    guildId: "guild-1",
    customId: args.customId,
    user: { id: args.userId, username: "Tester" },
    memberPermissions: {
      has: vi.fn(() => Boolean(args.hasManageGuild)),
    },
    deferred: false,
    replied: false,
    isButton: () => true,
    reply,
    editReply,
    followUp,
  };
}

function buildRoleSelectInteraction(args: {
  userId: string;
  customId: string;
  values: string[];
  hasManageGuild?: boolean;
}) {
  const reply = vi.fn(async (_payload: { content: string; ephemeral: boolean }) => undefined);
  const editReply = vi.fn(async (_payload: { content: string; ephemeral?: boolean }) => undefined);
  const followUp = vi.fn(async (_payload: { content: string; ephemeral: boolean }) => undefined);
  return {
    guildId: "guild-1",
    customId: args.customId,
    values: args.values,
    user: { id: args.userId, username: "Tester" },
    memberPermissions: {
      has: vi.fn(() => Boolean(args.hasManageGuild)),
    },
    deferred: false,
    replied: false,
    isButton: () => false,
    isStringSelectMenu: () => true,
    reply,
    editReply,
    followUp,
  };
}

function buildModalSubmitInteraction(args: {
  userId: string;
  customId: string;
  modalValue: string;
  hasManageGuild?: boolean;
}) {
  const reply = vi.fn(async (_payload: { content: string; ephemeral: boolean }) => undefined);
  const editReply = vi.fn(async (_payload: string | { content: string; ephemeral?: boolean }) => undefined);
  const followUp = vi.fn(async (_payload: { content: string; ephemeral: boolean }) => undefined);
  return {
    guildId: "guild-1",
    customId: args.customId,
    user: { id: args.userId, username: "Tester" },
    memberPermissions: {
      has: vi.fn(() => Boolean(args.hasManageGuild)),
    },
    fields: {
      getTextInputValue: vi.fn(() => args.modalValue),
    },
    deferred: false,
    replied: false,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isModalSubmit: () => true,
    reply,
    editReply,
    followUp,
    deferReply: vi.fn(async () => undefined),
  };
}

afterEach(() => {
  configuredDmUserId = "dm-user";
  runWakeMock.mockClear();
  vi.unstubAllEnvs();
  vi.resetModules();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore transient Windows file lock cleanup failures in test teardown.
      }
    }
  }
});

describe("awakening choice component gating", () => {
  test("rejects stale nonce click without mutating progress or scene", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-awaken-component-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const { meepo } = await import("../commands/meepo.js");
    const { getDbForCampaign } = await import("../db.js");
    const { initState, loadState, saveProgress } = await import("../ledger/awakeningStateRepo.js");
    const { buildChoicePromptCustomId } = await import("../awakening/prompts/choicePrompt.js");

    const db = getDbForCampaign("default");
    initState("guild-1", "meepo_awaken", 2, "choose_mode", { db });
    saveProgress("guild-1", "meepo_awaken", {
      voice_mode: "unset",
      await_input: { key: "voice_mode", kind: "choice" },
      pending_prompt_kind: "choice",
      pending_prompt_key: "voice_mode",
      pending_prompt_scene_id: "choose_mode",
      pending_prompt_nonce: "fresh-nonce",
      pending_prompt_created_at_ms: 123,
    }, { db });

    const before = loadState("guild-1", "meepo_awaken", { db });
    const interaction = buildButtonInteraction({
      userId: "dm-user",
      customId: buildChoicePromptCustomId({
        sceneId: "choose_mode",
        key: "voice_mode",
        nonce: "old-nonce",
        optionIndex: 0,
      }),
    });

    const handled = await meepo.handleComponentInteraction(interaction, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    const after = loadState("guild-1", "meepo_awaken", { db });
    expect(handled).toBe(true);
    expect(runWakeMock).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: "This awakening prompt is stale. Run /meepo awaken again.",
      ephemeral: true,
    });
    expect(after?.current_scene).toBe(before?.current_scene);
    expect(after?.progress_json.voice_mode).toBe("unset");
    expect(after?.progress_json.pending_prompt_nonce).toBe("fresh-nonce");
    db.close();
  });

  test("rejects non-DM click even with Manage Guild when DM identity is configured", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-awaken-component-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const { meepo } = await import("../commands/meepo.js");
    const { getDbForCampaign } = await import("../db.js");
    const { initState, loadState, saveProgress } = await import("../ledger/awakeningStateRepo.js");
    const { buildChoicePromptCustomId } = await import("../awakening/prompts/choicePrompt.js");

    const db = getDbForCampaign("default");
    initState("guild-1", "meepo_awaken", 2, "choose_mode", { db });
    saveProgress("guild-1", "meepo_awaken", {
      voice_mode: "unset",
      await_input: { key: "voice_mode", kind: "choice" },
      pending_prompt_kind: "choice",
      pending_prompt_key: "voice_mode",
      pending_prompt_scene_id: "choose_mode",
      pending_prompt_nonce: "fresh-nonce",
      pending_prompt_created_at_ms: 123,
    }, { db });

    const interaction = buildButtonInteraction({
      userId: "not-dm",
      hasManageGuild: true,
      customId: buildChoicePromptCustomId({
        sceneId: "choose_mode",
        key: "voice_mode",
        nonce: "fresh-nonce",
        optionIndex: 0,
      }),
    });

    const handled = await meepo.handleComponentInteraction(interaction, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    const after = loadState("guild-1", "meepo_awaken", { db });
    expect(handled).toBe(true);
    expect(runWakeMock).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Only the Dungeon Master can answer this awakening prompt.",
      ephemeral: true,
    });
    expect(after?.progress_json.voice_mode).toBe("unset");
    expect(after?.progress_json.pending_prompt_nonce).toBe("fresh-nonce");
    db.close();
  });

  test("allows bootstrap fallback when DM identity is unset and caller has Manage Guild", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-awaken-component-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    configuredDmUserId = null;

    const { meepo } = await import("../commands/meepo.js");
    const { getDbForCampaign } = await import("../db.js");
    const { initState, loadState, saveProgress } = await import("../ledger/awakeningStateRepo.js");
    const { buildChoicePromptCustomId } = await import("../awakening/prompts/choicePrompt.js");

    const db = getDbForCampaign("default");
    initState("guild-1", "meepo_awaken", 2, "choose_mode", { db });
    saveProgress("guild-1", "meepo_awaken", {
      voice_mode: "unset",
      await_input: { key: "voice_mode", kind: "choice" },
      pending_prompt_kind: "choice",
      pending_prompt_key: "voice_mode",
      pending_prompt_scene_id: "choose_mode",
      pending_prompt_nonce: "fresh-nonce",
      pending_prompt_created_at_ms: 123,
    }, { db });

    const interaction = buildButtonInteraction({
      userId: "bootstrap-admin",
      hasManageGuild: true,
      customId: buildChoicePromptCustomId({
        sceneId: "choose_mode",
        key: "voice_mode",
        nonce: "fresh-nonce",
        optionIndex: 0,
      }),
    });

    const handled = await meepo.handleComponentInteraction(interaction, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    const after = loadState("guild-1", "meepo_awaken", { db });
    expect(handled).toBe(true);
    expect(runWakeMock).toHaveBeenCalledTimes(1);
    expect(after?.progress_json.voice_mode).toBe("voice");
    expect(after?.progress_json.pending_prompt_kind).toBeNull();
    expect(after?.progress_json.pending_prompt_nonce).toBeNull();
    expect(interaction.editReply).toHaveBeenCalledWith("Awakening paused: beat budget reached for this run. Use /meepo awaken again to continue.");
    expect(interaction.reply).not.toHaveBeenCalledWith({
      content: "Only the Dungeon Master can answer this awakening prompt.",
      ephemeral: true,
    });
    db.close();
  });

  test("accepts continue click and resumes from pending continue state", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-awaken-component-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    configuredDmUserId = "dm-user";

    const { meepo } = await import("../commands/meepo.js");
    const { getDbForCampaign } = await import("../db.js");
    const { initState, loadState, saveProgress } = await import("../ledger/awakeningStateRepo.js");
    const { AWAKEN_CONTINUE_KEY, buildContinueCustomId } = await import("../awakening/prompts/continuePrompt.js");

    const db = getDbForCampaign("default");
    initState("guild-1", "meepo_awaken", 2, "choose_mode", { db });
    saveProgress("guild-1", "meepo_awaken", {
      await_input: { key: AWAKEN_CONTINUE_KEY, kind: "continue" },
      pending_prompt_kind: "continue",
      pending_prompt_key: AWAKEN_CONTINUE_KEY,
      pending_prompt_scene_id: "choose_mode",
      pending_prompt_nonce: "fresh-nonce",
      pending_prompt_created_at_ms: 123,
    }, { db });

    const interaction = buildButtonInteraction({
      userId: "dm-user",
      customId: buildContinueCustomId({ nonce: "fresh-nonce" }),
    });

    const handled = await meepo.handleComponentInteraction(interaction, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    const after = loadState("guild-1", "meepo_awaken", { db });
    expect(handled).toBe(true);
    expect(runWakeMock).toHaveBeenCalledTimes(1);
    expect(after?.progress_json[AWAKEN_CONTINUE_KEY]).toBe("choose_mode");
    expect(after?.progress_json.pending_prompt_kind).toBeNull();
    expect(after?.progress_json.pending_prompt_nonce).toBeNull();
    expect(interaction.editReply).toHaveBeenCalledWith("Awakening paused: beat budget reached for this run. Use /meepo awaken again to continue.");
    db.close();
  });

  test("accepts valid role_select submit and clears pending prompt", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-awaken-component-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    configuredDmUserId = "dm-user";

    const { meepo } = await import("../commands/meepo.js");
    const { getDbForCampaign } = await import("../db.js");
    const { initState, loadState, saveProgress } = await import("../ledger/awakeningStateRepo.js");
    const { buildRoleSelectPromptCustomId } = await import("../awakening/prompts/roleSelectPrompt.js");

    const db = getDbForCampaign("default");
    initState("guild-1", "meepo_awaken", 2, "dm_role", { db });
    saveProgress("guild-1", "meepo_awaken", {
      dm_role_id: null,
      await_input: { key: "dm_role_id", kind: "role_select" },
      pending_prompt_kind: "role_select",
      pending_prompt_key: "dm_role_id",
      pending_prompt_scene_id: "dm_role",
      pending_prompt_nonce: "fresh-nonce",
      pending_prompt_created_at_ms: 123,
    }, { db });

    const interaction = buildRoleSelectInteraction({
      userId: "dm-user",
      values: ["role-123"],
      customId: buildRoleSelectPromptCustomId({
        sceneId: "dm_role",
        key: "dm_role_id",
        nonce: "fresh-nonce",
      }),
    });

    const handled = await meepo.handleComponentInteraction(interaction, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    const after = loadState("guild-1", "meepo_awaken", { db });
    expect(handled).toBe(true);
    expect(runWakeMock).toHaveBeenCalledTimes(1);
    expect(after?.progress_json.dm_role_id).toBe("role-123");
    expect(after?.progress_json.pending_prompt_kind).toBeNull();
    expect(after?.progress_json.pending_prompt_nonce).toBeNull();
    expect(interaction.editReply).toHaveBeenCalledWith("Awakening paused: beat budget reached for this run. Use /meepo awaken again to continue.");
    db.close();
  });

  test("surfaces awaken-specific error when resume step throws", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-awaken-component-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const { meepo } = await import("../commands/meepo.js");
    const { getDbForCampaign } = await import("../db.js");
    const { initState, saveProgress } = await import("../ledger/awakeningStateRepo.js");
    const { buildChoicePromptCustomId } = await import("../awakening/prompts/choicePrompt.js");

    runWakeMock.mockRejectedValueOnce(new Error("resume failed"));

    const db = getDbForCampaign("default");
    initState("guild-1", "meepo_awaken", 2, "choose_mode", { db });
    saveProgress("guild-1", "meepo_awaken", {
      voice_mode: "unset",
      await_input: { key: "voice_mode", kind: "choice" },
      pending_prompt_kind: "choice",
      pending_prompt_key: "voice_mode",
      pending_prompt_scene_id: "choose_mode",
      pending_prompt_nonce: "fresh-nonce",
      pending_prompt_created_at_ms: 123,
    }, { db });

    const interaction = buildButtonInteraction({
      userId: "dm-user",
      customId: buildChoicePromptCustomId({
        sceneId: "choose_mode",
        key: "voice_mode",
        nonce: "fresh-nonce",
        optionIndex: 0,
      }),
    });

    await meepo.handleComponentInteraction(interaction, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    const errorPayload = interaction.reply.mock.calls.at(-1)?.[0]?.content as string;
    expect(errorPayload).toContain("ERR_AWAKEN_RESUME");
    expect(errorPayload).not.toContain("ERR_UNKNOWN");
    db.close();
  });

  test("registry add opens modal without deferring component reply first", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-awaken-component-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const { meepo } = await import("../commands/meepo.js");
    const { getDbForCampaign } = await import("../db.js");
    const { initState, saveProgress } = await import("../ledger/awakeningStateRepo.js");
    const { buildRegistryAddCustomId } = await import("../awakening/prompts/registryBuilderPrompt.js");

    const db = getDbForCampaign("default");
    initState("guild-1", "meepo_awaken", 2, "player_registry", { db });
    saveProgress("guild-1", "meepo_awaken", {
      players: [],
      await_input: { key: "players", kind: "registry_builder" },
      pending_prompt_kind: "registry_builder",
      pending_prompt_key: "players",
      pending_prompt_scene_id: "player_registry",
      pending_prompt_nonce: "rb-nonce",
      pending_prompt_created_at_ms: 123,
    }, { db });

    const interaction: any = {
      guildId: "guild-1",
      customId: buildRegistryAddCustomId({ sceneId: "player_registry", key: "players", nonce: "rb-nonce" }),
      user: { id: "dm-user", username: "Tester" },
      memberPermissions: { has: vi.fn(() => true) },
      deferred: false,
      replied: false,
      isButton: () => true,
      reply: vi.fn(async () => undefined),
      editReply: vi.fn(async () => undefined),
      followUp: vi.fn(async () => undefined),
      deferReply: vi.fn(async () => {
        interaction.deferred = true;
        return undefined;
      }),
      showModal: vi.fn(async () => undefined),
    };

    await meepo.handleComponentInteraction(interaction, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    expect(interaction.deferReply).not.toHaveBeenCalled();
    db.close();
  });

  test("accepts valid modal submit and clears pending prompt", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-awaken-component-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const { meepo } = await import("../commands/meepo.js");
    const { getDbForCampaign } = await import("../db.js");
    const { initState, loadState, saveProgress } = await import("../ledger/awakeningStateRepo.js");
    const { buildModalSubmitCustomId } = await import("../awakening/prompts/modalTextPrompt.js");

    const db = getDbForCampaign("default");
    initState("guild-1", "meepo_awaken", 2, "ask_dm_name", { db });
    saveProgress("guild-1", "meepo_awaken", {
      dm_display_name: null,
      await_input: { key: "dm_display_name", kind: "modal_text" },
      pending_prompt_kind: "modal_text",
      pending_prompt_key: "dm_display_name",
      pending_prompt_scene_id: "ask_dm_name",
      pending_prompt_nonce: "modal-nonce",
      pending_prompt_created_at_ms: 123,
    }, { db });

    const interaction = buildModalSubmitInteraction({
      userId: "dm-user",
      customId: buildModalSubmitCustomId({ sceneId: "ask_dm_name", key: "dm_display_name", nonce: "modal-nonce" }),
      modalValue: "DM Prime",
    });

    const handled = await meepo.handleComponentInteraction(interaction, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    const after = loadState("guild-1", "meepo_awaken", { db });
    expect(handled).toBe(true);
    expect(runWakeMock).toHaveBeenCalledTimes(1);
    expect(after?.progress_json.dm_display_name).toBe("DM Prime");
    expect(after?.progress_json.pending_prompt_kind).toBeNull();
    expect(after?.progress_json.pending_prompt_nonce).toBeNull();
    db.close();
  });
});
