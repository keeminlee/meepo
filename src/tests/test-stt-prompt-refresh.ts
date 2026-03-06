import Database from "better-sqlite3";
import { describe, expect, test, vi, afterEach } from "vitest";

vi.mock("../config/env.js", () => ({
  cfg: {
    stt: {
      prompt: "Jamison, Minx",
    },
    llm: {
      model: "mock-model",
    },
    logging: {
      level: "error",
      scopes: [],
      format: "pretty",
      debugLatch: false,
    },
    voice: {
      debug: false,
    },
    features: {
      contextInlineActionsDev: false,
    },
    meepoContextActions: {
      leaseTtlMs: 30_000,
      maxAttempts: 4,
      retryBaseMs: 500,
    },
  },
}));

vi.mock("../registry/loadRegistry.js", () => ({
  loadRegistryForScope: vi.fn(() => ({
    characters: [
      { canonical_name: "Louis" },
      { canonical_name: "minx" },
      { canonical_name: "Rei" },
    ],
  })),
}));

function createActionDb(): any {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE meepo_actions (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'canon',
      session_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      dedupe_key TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
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

describe("stt prompt refresh", () => {
  afterEach(async () => {
    const { clearGuildSttPromptCache } = await import("../voice/stt/promptState.js");
    clearGuildSttPromptCache();
  });

  test("merges fallback + registry names deterministically without sorting", async () => {
    const { buildSttPromptFromNames } = await import("../voice/stt/promptState.js");
    const prompt = buildSttPromptFromNames(
      ["Jamison", "Minx"],
      ["Louis", "minx", "Rei"]
    );
    expect(prompt).toBe("Jamison, Minx, Louis, Rei");
  });

  test("refresh action stores dynamic prompt for guild", async () => {
    const db = createActionDb();
    const now = Date.now();

    db.prepare(
      `INSERT INTO meepo_actions (
        id, guild_id, scope, session_id, action_type, dedupe_key, payload_json,
        status, lease_owner, lease_until_ms, attempts, last_error, created_at_ms, updated_at_ms, completed_at_ms
      ) VALUES (?, ?, 'canon', ?, 'refresh-stt-prompt', ?, ?, 'pending', NULL, NULL, 0, NULL, ?, ?, NULL)`
    ).run("action-1", "guild-1", "session-1", "refresh:guild-1:session-1", JSON.stringify({ reason: "session_start" }), now, now);

    const { processOneMeepoContextAction } = await import("../ledger/meepoContextActions.js");
    const { getGuildSttPrompt } = await import("../voice/stt/promptState.js");

    const processed = await processOneMeepoContextAction(db, "test-worker");
    expect(processed).toBe(true);

    const row = db.prepare(`SELECT status FROM meepo_actions WHERE id = ?`).get("action-1") as { status: string };
    expect(row.status).toBe("done");
    expect(getGuildSttPrompt("guild-1")).toBe("Jamison, Minx, Louis, Rei");
  });
});
