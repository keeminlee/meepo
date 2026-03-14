import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

const stubLegacyCommand = {
  data: {
    toJSON: () => ({
      name: "stub",
      description: "stub",
      options: [{ type: 1, name: "run", description: "run", options: [] }],
    }),
  },
  execute: vi.fn(async () => {}),
};

vi.mock("../commands/meepoLegacy.js", () => ({ meepo: stubLegacyCommand }));
vi.mock("../commands/starstory.js", () => ({
  executeLabAwakenRespond: vi.fn(async () => {}),
  executeLabDoctor: vi.fn(async () => {}),
  executeLabSleep: vi.fn(async () => {}),
}));
vi.mock("../commands/session.js", () => ({ session: stubLegacyCommand }));
vi.mock("../commands/meeps.js", () => ({ meeps: stubLegacyCommand }));
vi.mock("../commands/missions.js", () => ({ missions: stubLegacyCommand }));
vi.mock("../commands/goldmem.js", () => ({ goldmem: stubLegacyCommand }));

const tempDirs: string[] = [];

function configureHermeticEnv(tempDir: string): void {
  vi.stubEnv("DATA_ROOT", tempDir);
  vi.stubEnv("DATA_CAMPAIGNS_DIR", "campaigns");
  vi.stubEnv("DATA_DB_FILENAME", "db.sqlite");
  vi.stubEnv("DISCORD_TOKEN", "test-token");
  vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
  vi.stubEnv("DEV_USER_IDS", "dev-user");
  vi.stubEnv("MIGRATIONS_SILENT", "1");
}

function buildInteraction(confirm: string) {
  const reply = vi.fn(async () => undefined);
  return {
    guildId: "guild-1",
    channelId: "channel-1",
    guild: { name: "Guild" },
    user: { id: "dev-user", username: "Dev" },
    options: {
      getSubcommandGroup: () => "awaken",
      getSubcommand: () => "reset",
      getString: (name: string, required?: boolean) => {
        if (name === "confirm") return confirm;
        if (required) throw new Error(`missing required option: ${name}`);
        return null;
      },
    },
    reply,
  };
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
        // ignore cleanup races
      }
    }
  }
});

describe("/lab awaken reset", () => {
  test("wrong confirm blocks reset and preserves onboarding rows", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-lab-awaken-reset-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const { lab } = await import("../commands/lab.js");
    const { getDbForCampaign, getControlDb } = await import("../db.js");
    const { initState } = await import("../ledger/awakeningStateRepo.js");

    const db = getDbForCampaign("default");
    const controlDb = getControlDb();
    initState("guild-1", "meepo_awaken", 2, "cold_open", { db });
    controlDb
      .prepare("INSERT OR REPLACE INTO guild_config (guild_id, campaign_slug, awakened) VALUES (?, ?, ?)")
      .run("guild-1", "default", 1);

    const interaction = buildInteraction("NOPE");
    await lab.execute(interaction as any, {
      guildId: "guild-1",
      guildName: "Guild",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    const onboardingRows = db
      .prepare("SELECT COUNT(*) AS n FROM guild_onboarding_state WHERE guild_id = ?")
      .get("guild-1") as { n: number };
    const awakenedRow = controlDb
      .prepare("SELECT awakened FROM guild_config WHERE guild_id = ?")
      .get("guild-1") as { awakened: number } | undefined;

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Confirmation failed. Use exactly: /lab awaken reset confirm:RESET",
      ephemeral: true,
    });
    expect(onboardingRows.n).toBe(1);
    expect(awakenedRow?.awakened).toBe(1);

    db.close();
    controlDb.close();
  });

  test("reset deletes onboarding state only and preserves sessions/artifacts", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-lab-awaken-reset-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const { lab } = await import("../commands/lab.js");
    const { getDbForCampaign, getControlDb } = await import("../db.js");
    const { initState } = await import("../ledger/awakeningStateRepo.js");

    const db = getDbForCampaign("default");
    const controlDb = getControlDb();

    initState("guild-1", "meepo_awaken", 2, "cold_open", { db });
    db.exec("CREATE TABLE IF NOT EXISTS onboarding_progress (guild_id TEXT NOT NULL, progress_json TEXT)");
    db.prepare("INSERT INTO onboarding_progress (guild_id, progress_json) VALUES (?, ?)")
      .run("guild-1", "{}");

    db.prepare(
      `INSERT INTO sessions (
        session_id, guild_id, kind, mode_at_start, label, created_at_ms, started_at_ms, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("s1", "guild-1", "canon", "ambient", "C2E1", 1000, 1000, "live");

    db.prepare(
      `INSERT INTO session_artifacts (
        id, session_id, artifact_type, created_at_ms, strategy
      ) VALUES (?, ?, ?, ?, ?)`
    ).run("a1", "s1", "recap_final", 1200, "balanced");

    controlDb
      .prepare("INSERT OR REPLACE INTO guild_config (guild_id, campaign_slug, awakened) VALUES (?, ?, ?)")
      .run("guild-1", "default", 1);

    const beforeSessions = db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE guild_id = ?").get("guild-1") as { n: number };
    const beforeArtifacts = db.prepare("SELECT COUNT(*) AS n FROM session_artifacts WHERE session_id = ?").get("s1") as { n: number };

    const interaction = buildInteraction("RESET");
    await lab.execute(interaction as any, {
      guildId: "guild-1",
      guildName: "Guild",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    const onboardingRows = db
      .prepare("SELECT COUNT(*) AS n FROM guild_onboarding_state WHERE guild_id = ?")
      .get("guild-1") as { n: number };
    const legacyRows = db
      .prepare("SELECT COUNT(*) AS n FROM onboarding_progress WHERE guild_id = ?")
      .get("guild-1") as { n: number };
    const afterSessions = db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE guild_id = ?").get("guild-1") as { n: number };
    const afterArtifacts = db.prepare("SELECT COUNT(*) AS n FROM session_artifacts WHERE session_id = ?").get("s1") as { n: number };
    const awakenedRow = controlDb
      .prepare("SELECT awakened FROM guild_config WHERE guild_id = ?")
      .get("guild-1") as { awakened: number } | undefined;

    const replyMock = interaction.reply as any;
    const firstCall = Array.isArray(replyMock?.mock?.calls) ? replyMock.mock.calls[0] : undefined;
    const payload = (firstCall?.[0] ?? {}) as { content: string; ephemeral: boolean };
    expect(payload.ephemeral).toBe(true);
    expect(payload.content).toContain("Deleted: onboarding_progress (2 rows), awakened flag (cleared)");
    expect(payload.content).toContain("Preserved: sessions, transcripts, artifacts, recaps");

    expect(onboardingRows.n).toBe(0);
    expect(legacyRows.n).toBe(0);
    expect(afterSessions.n).toBe(beforeSessions.n);
    expect(afterArtifacts.n).toBe(beforeArtifacts.n);
    expect(awakenedRow?.awakened).toBe(0);

    db.close();
    controlDb.close();
  });
});
