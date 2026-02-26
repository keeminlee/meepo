import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, expect, test, vi } from "vitest";

const tempDirs: string[] = [];

function configureEnv(tempDir: string): void {
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

test("buildTranscriptFromLedger excludes system events such as voice interrupts", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-transcript-"));
  tempDirs.push(tempDir);
  configureEnv(tempDir);

  const { buildTranscriptFromLedger } = await import("../ledger/transcripts.js");

  const db = new Database(path.join(tempDir, "test.sqlite"));
  db.exec(`
    CREATE TABLE ledger_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      author_name TEXT NOT NULL,
      content TEXT NOT NULL,
      content_norm TEXT,
      timestamp_ms INTEGER NOT NULL,
      source TEXT NOT NULL,
      narrative_weight TEXT NOT NULL
    );
  `);

  const sessionId = "session-1";

  db.prepare(`
    INSERT INTO ledger_entries (session_id, author_name, content, content_norm, timestamp_ms, source, narrative_weight)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId, "System", "Voice playback interrupted", "voice playback interrupted", 1000, "system", "secondary");

  db.prepare(`
    INSERT INTO ledger_entries (session_id, author_name, content, content_norm, timestamp_ms, source, narrative_weight)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId, "Player", "hello meepo", "hello meepo", 1001, "voice", "primary");

  const transcript = buildTranscriptFromLedger(sessionId, true, db);

  expect(transcript).toHaveLength(1);
  expect(transcript[0]?.author_name).toBe("Player");
  expect(transcript[0]?.content).toBe("hello meepo");

  db.close();
});
