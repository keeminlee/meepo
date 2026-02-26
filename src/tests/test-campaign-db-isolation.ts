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

test("campaign A data is not readable from campaign B", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-db-iso-"));
  tempDirs.push(tempDir);
  configureHermeticEnv(tempDir);
  vi.resetModules();

  const { getDbForCampaign } = await import("../db.js");

  const campaignA = `test-a-${Date.now()}`;
  const campaignB = `test-b-${Date.now()}`;
  const dbA = getDbForCampaign(campaignA);
  const dbB = getDbForCampaign(campaignB);

  dbA.exec("CREATE TABLE IF NOT EXISTS test_kv (key TEXT PRIMARY KEY, value TEXT)");
  dbB.exec("CREATE TABLE IF NOT EXISTS test_kv (key TEXT PRIMARY KEY, value TEXT)");

  const sentinelKey = `sentinel-${Date.now()}`;
  const sentinelValue = "A-only";
  dbA.prepare("INSERT INTO test_kv (key, value) VALUES (?, ?)").run(sentinelKey, sentinelValue);

  const fromA = dbA.prepare("SELECT value FROM test_kv WHERE key = ?").get(sentinelKey) as
    | { value: string }
    | undefined;
  const fromB = dbB.prepare("SELECT value FROM test_kv WHERE key = ?").get(sentinelKey) as
    | { value: string }
    | undefined;

  expect(fromA?.value).toBe(sentinelValue);
  expect(fromB).toBeUndefined();

  dbA.close();
  dbB.close();
});
