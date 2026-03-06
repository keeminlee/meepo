import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
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
        // Ignore transient Windows file lock cleanup failures in test teardown.
      }
    }
  }
});

test("control DB bootstrap tolerates legacy sessions schema missing status", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-db-compat-"));
  tempDirs.push(tempDir);
  configureHermeticEnv(tempDir);

  const controlDir = path.join(tempDir, "control");
  fs.mkdirSync(controlDir, { recursive: true });
  const legacyControlDbPath = path.join(controlDir, "control.sqlite");

  const legacyDb = new Database(legacyControlDbPath);
  legacyDb.exec(`
    CREATE TABLE sessions (
      session_id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      label TEXT,
      started_at_ms INTEGER NOT NULL,
      ended_at_ms INTEGER,
      started_by_id TEXT,
      started_by_name TEXT
    );
  `);
  legacyDb.close();

  const { getControlDb } = await import("../db.js");
  const db = getControlDb();

  const sessionColumns = db
    .prepare("PRAGMA table_info(sessions)")
    .all() as Array<{ name: string }>;
  const sessionColumnNames = sessionColumns.map((column) => column.name);

  expect(sessionColumnNames).toContain("status");
  expect(sessionColumnNames).toContain("kind");
  expect(sessionColumnNames).toContain("mode_at_start");

  const sessionIndexes = db
    .prepare("PRAGMA index_list(sessions)")
    .all() as Array<{ name: string }>;
  const indexNames = sessionIndexes.map((index) => index.name);

  expect(indexNames).toContain("idx_one_active_session_per_guild");

  db.close();
});
