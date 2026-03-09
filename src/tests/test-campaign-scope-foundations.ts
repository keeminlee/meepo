import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";

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
  vi.unstubAllEnvs();
  vi.resetModules();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore transient Windows file lock cleanup issues.
      }
    }
  }
});

test("campaign scope slug helper follows underscore doctrine", async () => {
  const { slugifyCampaignScopeName } = await import("../campaign/campaignScopeSlug.js");

  expect(slugifyCampaignScopeName("Keemin's D&D Server")).toBe("keemin_s_d_d_server");
  expect(slugifyCampaignScopeName(" Echoes   of --- Avernus ")).toBe("echoes_of_avernus");
  expect(slugifyCampaignScopeName("___")).toBe("default");
});

test("showtime campaign records persist and collision suffixing is deterministic", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-campaign-scope-"));
  tempDirs.push(tempDir);
  configureHermeticEnv(tempDir);

  const { getDbForCampaign, getControlDb } = await import("../db.js");
  const {
    createShowtimeCampaign,
    getShowtimeCampaignBySlug,
    listShowtimeCampaigns,
  } = await import("../campaign/showtimeCampaigns.js");

  // Initialize both campaign DB and control DB so schema + migrations are in place.
  const campaignDb = getDbForCampaign("default");
  const controlDb = getControlDb();

  const createdOne = createShowtimeCampaign({
    guildId: "guild-1",
    campaignName: "Echoes of Avernus",
    createdByUserId: "user-1",
  });
  const createdTwo = createShowtimeCampaign({
    guildId: "guild-1",
    campaignName: "Echoes of Avernus",
    createdByUserId: "user-1",
  });

  createShowtimeCampaign({
    guildId: "guild-2",
    campaignName: "Echoes of Avernus",
    createdByUserId: "user-2",
  });

  expect(createdOne.campaign_slug).toBe("echoes_of_avernus");
  expect(createdTwo.campaign_slug).toBe("echoes_of_avernus_2");

  const found = getShowtimeCampaignBySlug("guild-1", "ECHOES_OF_AVERNUS_2");
  expect(found?.campaign_name).toBe("Echoes of Avernus");

  const all = listShowtimeCampaigns("guild-1");
  expect(all).toHaveLength(2);

  const allGuildTwo = listShowtimeCampaigns("guild-2");
  expect(allGuildTwo).toHaveLength(1);
  expect(allGuildTwo[0]?.campaign_slug).toBe("echoes_of_avernus");
  expect(getShowtimeCampaignBySlug("guild-2", "echoes_of_avernus_2")).toBeNull();

  campaignDb.close();
  controlDb.close();
});
