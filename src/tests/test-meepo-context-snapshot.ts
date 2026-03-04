import Database from "better-sqlite3";
import { afterEach, describe, expect, test, vi } from "vitest";
import { serializeRawLines, type ContextRawLine } from "../ledger/meepoContextRepo.js";

let db: any;

vi.mock("../db.js", () => ({
  getDbForCampaign: vi.fn(() => db),
}));

vi.mock("../campaign/guildConfig.js", () => ({
  resolveCampaignSlug: vi.fn(() => "default"),
  getGuildDmUserId: vi.fn(() => null),
}));

vi.mock("../sessions/sessionRuntime.js", () => ({
  getGuildMode: vi.fn(() => "ambient"),
}));

vi.mock("../config/env.js", () => ({
  cfg: {
    llm: {
      voiceContextMs: 120_000,
    },
    features: {
      contextMiniFirst: false,
    },
  },
}));

function createDb(): any {
  const instance = new Database(":memory:");
  instance.exec(`
    CREATE TABLE meepo_context (
      guild_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      revision_id INTEGER NOT NULL,
      ledger_cursor_id TEXT,
      canon_line_cursor_total INTEGER NOT NULL DEFAULT 0,
      canon_line_cursor_watermark INTEGER NOT NULL DEFAULT 0,
      token_estimate INTEGER NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      PRIMARY KEY (guild_id, scope, session_id)
    );

    CREATE TABLE meepo_context_blocks (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      kind TEXT NOT NULL,
      seq INTEGER NOT NULL,
      content TEXT NOT NULL,
      token_estimate INTEGER NOT NULL,
      source_range_json TEXT,
      superseded_at_ms INTEGER
    );
  `);
  return instance;
}

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  if (db) {
    db.close();
    db = null;
  }
});

describe("loadMeepoContextSnapshot", () => {
  test("loads context only from context blocks and formats recent lines", async () => {
    db = createDb();
    const now = Date.now();

    db.prepare(
      `INSERT INTO meepo_context (guild_id, session_id, scope, revision_id, ledger_cursor_id, token_estimate, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("guild-1", "session-1", "canon", 5, "cursor-1", 99, now - 2000, now);

    const lines: ContextRawLine[] = [
      {
        id: "old-1",
        author_id: "u1",
        author_name: "Alice",
        content: "too old",
        source: "text",
        timestamp_ms: now - 10_000,
      },
      {
        id: "new-1",
        author_id: "u1",
        author_name: "Alice",
        content: "hello there",
        source: "text",
        timestamp_ms: now - 300,
      },
      {
        id: "new-2",
        author_id: "u2",
        author_name: "Bob",
        content: "reply by voice",
        source: "voice",
        timestamp_ms: now - 200,
      },
    ];

    db.prepare(
      `INSERT INTO meepo_context_blocks (id, guild_id, session_id, scope, kind, seq, content, token_estimate, source_range_json, superseded_at_ms)
       VALUES (?, ?, ?, ?, 'raw_lines', 1, ?, ?, ?, NULL)`
    ).run(
      "block-1",
      "guild-1",
      "session-1",
      "canon",
      serializeRawLines(lines),
      20,
      JSON.stringify({ start_ledger_id: "old-1", end_ledger_id: "new-2", count: 3 })
    );

    const { loadMeepoContextSnapshot } = await import("../recall/loadMeepoContextSnapshot.js");
    const result = await loadMeepoContextSnapshot({
      guildId: "guild-1",
      sessionId: "session-1",
      windowMs: 1000,
      limit: 20,
    });

    expect(result.context).toContain("Alice: hello there");
    expect(result.context).toContain("Bob: reply by voice");
    expect(result.context).not.toContain("too old");
    expect(result.hasVoice).toBe(true);
    expect(result.revisionId).toBe(5);
    expect(result.tokenEstimate).toBe(99);
  });

  test("returns empty snapshot when no context row exists", async () => {
    db = createDb();

    const { loadMeepoContextSnapshot } = await import("../recall/loadMeepoContextSnapshot.js");
    const result = await loadMeepoContextSnapshot({
      guildId: "guild-1",
      sessionId: "session-x",
    });

    expect(result.context).toBe("");
    expect(result.hasVoice).toBe(false);
    expect(result.revisionId).toBe(0);
    expect(result.tokenEstimate).toBe(0);
  });
});
