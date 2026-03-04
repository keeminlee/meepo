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
  getGuildMode: vi.fn(() => "canon"),
}));

vi.mock("../config/env.js", () => ({
  cfg: {
    llm: {
      voiceContextMs: 120_000,
    },
    features: {
      contextMiniFirst: true,
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

describe("loadMeepoContextSnapshot mini-first", () => {
  test("prefers latest mini_meecap block when feature flag is enabled", async () => {
    db = createDb();
    const now = Date.now();

    db.prepare(
      `INSERT INTO meepo_context (guild_id, session_id, scope, revision_id, ledger_cursor_id, token_estimate, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("guild-1", "session-1", "canon", 8, "cursor-1", 120, now - 1000, now);

    const rawLines: ContextRawLine[] = [
      {
        id: "r1",
        author_id: "u1",
        author_name: "Alice",
        content: "raw hello",
        source: "text",
        timestamp_ms: now - 100,
      },
    ];

    db.prepare(
      `INSERT INTO meepo_context_blocks (id, guild_id, session_id, scope, kind, seq, content, token_estimate, source_range_json, superseded_at_ms)
       VALUES ('raw-1', ?, ?, 'canon', 'raw_lines', 1, ?, 10, NULL, NULL)`
    ).run("guild-1", "session-1", serializeRawLines(rawLines));

    db.prepare(
      `INSERT INTO meepo_context_blocks (id, guild_id, session_id, scope, kind, seq, content, token_estimate, source_range_json, superseded_at_ms)
       VALUES ('mini-1', ?, ?, 'canon', 'mini_meecap', 1, ?, 30, NULL, NULL)`
    ).run("guild-1", "session-1", "Mini meecap lines 1-250\nAlice: summary");

    const { loadMeepoContextSnapshot } = await import("../recall/loadMeepoContextSnapshot.js");
    const result = await loadMeepoContextSnapshot({
      guildId: "guild-1",
      sessionId: "session-1",
      windowMs: 1000,
      limit: 20,
    });

    expect(result.context).toContain("Mini meecap lines 1-250");
    expect(result.context).not.toContain("raw hello");
    expect(result.revisionId).toBe(8);
    expect(result.tokenEstimate).toBe(120);
  });
});
