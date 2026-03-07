import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

process.env.DISCORD_TOKEN ??= "test-token";
process.env.OPENAI_API_KEY ??= "test-openai-key";

const tempDirs: string[] = [];

vi.mock("../security/isElevated.js", () => ({
  isElevated: vi.fn(() => true),
}));

vi.mock("../meepo/state.js", () => ({
  getActiveMeepo: vi.fn(() => null),
  wakeMeepo: vi.fn(() => undefined),
  sleepMeepo: vi.fn(() => true),
}));

vi.mock("../sessions/transcriptExport.js", () => ({
  ensureBronzeTranscriptExportCached: vi.fn(() => ({ cacheHit: false })),
}));

vi.mock("../sessions/recapEngine.js", () => ({
  generateSessionRecap: vi.fn(async () => ({ cacheHit: false })),
}));

function configureHermeticEnv(tempDir: string): void {
  vi.stubEnv("DATA_ROOT", tempDir);
  vi.stubEnv("DATA_CAMPAIGNS_DIR", "campaigns");
  vi.stubEnv("DATA_DB_FILENAME", "db.sqlite");
  vi.stubEnv("MIGRATIONS_SILENT", "1");
  vi.stubEnv("DEFAULT_CAMPAIGN_SLUG", "default");
}

function buildLegacyButtonInteraction(customId: string) {
  const reply = vi.fn(async (_payload: { content: string; ephemeral: boolean }) => undefined);
  const editReply = vi.fn(async (_payload: { content: string; ephemeral?: boolean }) => undefined);
  const followUp = vi.fn(async (_payload: { content: string; ephemeral: boolean }) => undefined);
  return {
    guildId: "guild-1",
    customId,
    user: { id: "dm-user", username: "DM" },
    memberPermissions: { has: vi.fn(() => true) },
    deferred: false,
    replied: false,
    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    reply,
    editReply,
    followUp,
  } as any;
}

afterEach(() => {
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

describe("run 2 authority enforcement", () => {
  test("legacy awaken component interactions are handled with migration guidance", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-awaken-component-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const { meepo } = await import("../commands/meepo.js");
    const { getDbForCampaign } = await import("../db.js");
    const { buildChoicePromptCustomId } = await import("../awakening/prompts/choicePrompt.js");

    const db = getDbForCampaign("default");
    const interaction = buildLegacyButtonInteraction(
      buildChoicePromptCustomId({
        sceneId: "choose_mode",
        key: "voice_mode",
        nonce: "nonce-1",
        optionIndex: 0,
      })
    );

    const handled = await meepo.handleComponentInteraction(interaction, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    expect(handled).toBe(true);
    expect(interaction.reply).toHaveBeenCalledTimes(1);
    const content = String(interaction.reply.mock.calls[0]?.[0]?.content ?? "");
    expect(content).toContain("Awakening wizard prompts are retired");
    db.close();
  });

  test("legacy continue component interactions are also unreachable in production flow", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-awaken-component-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const { meepo } = await import("../commands/meepo.js");
    const { getDbForCampaign } = await import("../db.js");
    const { buildContinueCustomId } = await import("../awakening/prompts/continuePrompt.js");

    const db = getDbForCampaign("default");
    const interaction = buildLegacyButtonInteraction(
      buildContinueCustomId({
        nonce: "nonce-2",
      })
    );

    const handled = await meepo.handleComponentInteraction(interaction, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    expect(handled).toBe(true);
    expect(interaction.reply).toHaveBeenCalledTimes(1);
    const content = String(interaction.reply.mock.calls[0]?.[0]?.content ?? "");
    expect(content).toContain("Awakening wizard prompts are retired");
    db.close();
  });

  test("showtime end rejects cleanly when no active session exists", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-awaken-component-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const { meepo } = await import("../commands/meepo.js");
    const { getDbForCampaign } = await import("../db.js");

    const db = getDbForCampaign("default");
    const awakenInteraction = {
      guildId: "guild-1",
      channelId: "channel-1",
      guild: { name: "Guild One" },
      member: {},
      memberPermissions: { has: vi.fn(() => true) },
      user: { id: "dm-user", username: "DM" },
      deferred: false,
      replied: false,
      reply: vi.fn(async (_payload: unknown) => undefined),
      options: {
        getSubcommandGroup: () => null,
        getSubcommand: () => "awaken",
        getString: () => null,
      },
    } as any;

    await meepo.execute(awakenInteraction, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    const interaction = {
      guildId: "guild-1",
      channelId: "channel-1",
      guild: { name: "Guild One" },
      member: {},
      memberPermissions: { has: vi.fn(() => true) },
      user: { id: "dm-user", username: "DM" },
      deferred: false,
      replied: false,
      reply: vi.fn(async (_payload: unknown) => undefined),
      options: {
        getSubcommandGroup: () => "showtime",
        getSubcommand: () => "end",
        getString: () => null,
      },
    } as any;

    await meepo.execute(interaction, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    const content = String(interaction.reply.mock.calls[0]?.[0]?.content ?? "");
    expect(content).toContain("No active showtime session");
    db.close();
  });
});
