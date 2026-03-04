import Database from "better-sqlite3";
import { describe, expect, test, vi } from "vitest";

vi.mock("../config/env.js", () => ({
  cfg: {
    llm: { model: "mock-model" },
    logging: {
      level: "error",
      scopes: [],
      format: "pretty",
      debugLatch: false,
    },
    voice: { debug: false },
    features: { contextInlineActionsDev: false },
    meepoContextActions: {
      leaseTtlMs: 30_000,
      maxAttempts: 4,
      retryBaseMs: 500,
    },
  },
}));

vi.mock("../ledger/meepoMindRetrieveAction.js", () => ({
  executeMeepoMindRetrieveAction: vi.fn(() => ({
    artifactPath: "artifact.json",
    alwaysCount: 0,
    rankedCount: 0,
    dbMs: 0,
  })),
}));

function createTestDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE meepo_actions (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      session_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      dedupe_key TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      lease_owner TEXT,
      lease_until_ms INTEGER,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      completed_at_ms INTEGER,
      UNIQUE(dedupe_key)
    );
  `);
  return db;
}

describe("meepo mind retrieval dedupe", () => {
  test("same anchor/query only enqueues one action", async () => {
    const { enqueueMeepoMindRetrieveIfNeeded } = await import("../ledger/meepoContextActions.js");
    const db = createTestDb();

    const first = enqueueMeepoMindRetrieveIfNeeded(db, {
      guildId: "guild-1",
      campaignSlug: "default",
      scope: "canon",
      sessionId: "session-1",
      anchorLedgerId: "48392",
      queryText: "Hello World",
      queryHash: "abcd1234",
      topK: 8,
      algoVersion: "v1.2.1",
      nowMs: 1_000,
      runKind: "online",
    });

    const second = enqueueMeepoMindRetrieveIfNeeded(db, {
      guildId: "guild-1",
      campaignSlug: "default",
      scope: "canon",
      sessionId: "session-1",
      anchorLedgerId: "48392",
      queryText: "Hello World",
      queryHash: "abcd1234",
      topK: 8,
      algoVersion: "v1.2.1",
      nowMs: 1_001,
      runKind: "online",
    });

    const rows = db.prepare("SELECT COUNT(*) AS n FROM meepo_actions").get() as { n: number };
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(rows.n).toBe(1);
  });
});
