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

function configureHermeticEnv(tempDir: string): void {
  vi.stubEnv("DATA_ROOT", tempDir);
  vi.stubEnv("DATA_CAMPAIGNS_DIR", "campaigns");
  vi.stubEnv("DATA_DB_FILENAME", "db.sqlite");
  vi.stubEnv("MIGRATIONS_SILENT", "1");
  vi.stubEnv("DEFAULT_CAMPAIGN_SLUG", "default");
}

function buildWakeInteraction(response: string) {
  const reply = vi.fn(async (_payload: { content: string; ephemeral: boolean }) => undefined);
  return {
    guildId: "guild-1",
    channelId: "channel-1",
    guild: { name: "Guild One" },
    member: {},
    memberPermissions: { has: vi.fn(() => true) },
    user: { id: "dm-user", username: "DM" },
    deferred: false,
    replied: false,
    options: {
      getSubcommandGroup: () => null,
      getSubcommand: () => "wake",
      getString: (name: string) => (name === "response" ? response : null),
    },
    reply,
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
        // Ignore transient Windows file-lock cleanup failures in test teardown.
      }
    }
  }
});

describe("/meepo wake legacy response input behavior", () => {
  test("wake ignores legacy response text and follows awaken path", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-wake-response-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const { meepo } = await import("../commands/meepo.js");
    const { getDbForCampaign } = await import("../db.js");

    const db = getDbForCampaign("default");
    const interaction = buildWakeInteraction("legacy-response-text");

    await meepo.execute(interaction, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    const content = String(interaction.reply.mock.calls[0]?.[0]?.content ?? "");
    expect(content).toContain("The Archive is now attentive.");
    expect(content).toContain("Guild setup is complete for Closed Alpha.");
    expect(content).toContain("/meepo showtime start");
    db.close();
  });

  test("second wake after initialization returns already-awakened guidance", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-wake-response-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const { meepo } = await import("../commands/meepo.js");
    const { getDbForCampaign } = await import("../db.js");

    const db = getDbForCampaign("default");

    await meepo.execute(buildWakeInteraction("first"), {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    const second = buildWakeInteraction("second");
    await meepo.execute(second, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    const secondContent = String(second.reply.mock.calls[0]?.[0]?.content ?? "");
    expect(secondContent).toContain("already awakened");
    db.close();
  });
});
