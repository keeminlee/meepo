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

const wakeMeepoMock = vi.fn(() => undefined);
vi.mock("../meepo/state.js", () => ({
  getActiveMeepo: vi.fn(() => null),
  wakeMeepo: wakeMeepoMock,
  sleepMeepo: vi.fn(() => true),
}));

vi.mock("../voice/connection.js", () => ({
  joinVoice: vi.fn(),
  leaveVoice: vi.fn(),
}));

function configureHermeticEnv(tempDir: string): void {
  vi.stubEnv("DATA_ROOT", tempDir);
  vi.stubEnv("DATA_CAMPAIGNS_DIR", "campaigns");
  vi.stubEnv("DATA_DB_FILENAME", "db.sqlite");
  vi.stubEnv("MIGRATIONS_SILENT", "1");
  vi.stubEnv("DEFAULT_CAMPAIGN_SLUG", "default");
}

function buildWakeInteraction() {
  const reply = vi.fn(async (_payload: { content: string; ephemeral: boolean }) => undefined);
  return {
    guildId: "guild-1",
    channelId: "channel-1",
    guild: { name: "Guild One", voiceAdapterCreator: {} },
    member: {},
    memberPermissions: { has: vi.fn(() => true) },
    user: { id: "dm-user", username: "DM" },
    deferred: false,
    replied: false,
    options: {
      getSubcommandGroup: () => null,
      getSubcommand: () => "wake",
      getString: () => null,
    },
    reply,
  } as any;
}

afterEach(() => {
  wakeMeepoMock.mockReset();
  vi.unstubAllEnvs();
  vi.resetModules();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore transient Windows file-lock cleanup issues.
      }
    }
  }
});

describe("/meepo wake alias behavior", () => {
  test("wake behaves as awaken and enables ambient guidance", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-wake-alias-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const { meepo } = await import("../commands/meepo.js");
    const { getDbForCampaign } = await import("../db.js");
    const { getActiveSession } = await import("../sessions/sessions.js");
    const { getGuildAwakened } = await import("../campaign/guildConfig.js");

    const db = getDbForCampaign("default");
    const interaction = buildWakeInteraction();

    await meepo.execute(interaction, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    const content = String(interaction.reply.mock.calls[0]?.[0]?.content ?? "");
    expect(content).toContain("The Archive is now attentive.");
    expect(content).toContain("Guild setup is complete for Closed Alpha.");
    expect(content).toContain("/meepo showtime start");
    expect(getGuildAwakened("guild-1")).toBe(true);
    expect(getActiveSession("guild-1")).toBeNull();
    expect(wakeMeepoMock).toHaveBeenCalledTimes(1);
    db.close();
  });

  test("repeat wake gives harmless already-awakened guidance", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-wake-alias-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const { meepo } = await import("../commands/meepo.js");
    const { getDbForCampaign } = await import("../db.js");

    const db = getDbForCampaign("default");
    const first = buildWakeInteraction();
    const second = buildWakeInteraction();

    await meepo.execute(first, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    await meepo.execute(second, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    const content = String(second.reply.mock.calls[0]?.[0]?.content ?? "");
    expect(content).toContain("already awakened");
    db.close();
  });
});
