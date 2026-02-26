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
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("unknown guild auto-creates mapping and remains idempotent", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-guild-map-"));
  tempDirs.push(tempDir);
  configureHermeticEnv(tempDir);
  vi.resetModules();

  const { resolveCampaignSlug } = await import("../campaign/guildConfig.js");
  const { getControlDb } = await import("../db.js");

  const guildId = `guild-${Date.now()}`;
  const first = resolveCampaignSlug({ guildId, guildName: "Test Guild Alpha" });
  expect(first).toBeTruthy();
  expect(first.length).toBeGreaterThan(0);

  const db = getControlDb();
  const rows = db
    .prepare("SELECT guild_id, campaign_slug FROM guild_config WHERE guild_id = ?")
    .all(guildId) as Array<{ guild_id: string; campaign_slug: string }>;

  expect(rows.length).toBe(1);
  expect(rows[0].campaign_slug).toBe(first);

  const second = resolveCampaignSlug({ guildId, guildName: "Different Name" });
  expect(second).toBe(first);

  const countRow = db
    .prepare("SELECT COUNT(*) as count FROM guild_config WHERE guild_id = ?")
    .get(guildId) as { count: number };
  expect(countRow.count).toBe(1);

  db.close();
});
