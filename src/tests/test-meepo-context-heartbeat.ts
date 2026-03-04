import Database from "better-sqlite3";
import { describe, expect, test, vi } from "vitest";
import { runHeartbeatAfterLedgerWrite } from "../ledger/meepoContextHeartbeat.js";
import { parseRawLines } from "../ledger/meepoContextRepo.js";

vi.mock("../config/env.js", () => ({
  cfg: {
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

function createTestDb(): any {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE ledger_entries (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      session_id TEXT,
      author_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT NOT NULL,
      timestamp_ms INTEGER NOT NULL
    );

    CREATE TABLE meepo_context (
      guild_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'canon',
      revision_id INTEGER NOT NULL DEFAULT 0,
      ledger_cursor_id TEXT,
      canon_line_cursor_total INTEGER NOT NULL DEFAULT 0,
      canon_line_cursor_watermark INTEGER NOT NULL DEFAULT 0,
      token_estimate INTEGER NOT NULL DEFAULT 0,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      PRIMARY KEY (guild_id, scope, session_id)
    );

    CREATE TABLE meepo_context_blocks (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'canon',
      kind TEXT NOT NULL DEFAULT 'raw_lines',
      seq INTEGER NOT NULL,
      content TEXT NOT NULL,
      token_estimate INTEGER NOT NULL DEFAULT 0,
      source_range_json TEXT,
      superseded_at_ms INTEGER,
      UNIQUE(guild_id, scope, session_id, kind, seq)
    );

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

function insertLedgerEntry(db: any, args: {
  id: string;
  guildId: string;
  sessionId: string | null;
  authorId: string;
  authorName: string;
  content: string;
  source: "text" | "voice" | "system";
  timestampMs: number;
}) {
  db.prepare(
    `INSERT INTO ledger_entries (id, guild_id, session_id, author_id, author_name, content, source, timestamp_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    args.id,
    args.guildId,
    args.sessionId,
    args.authorId,
    args.authorName,
    args.content,
    args.source,
    args.timestampMs
  );
}

describe("meepo context heartbeat", () => {
  test("is idempotent and keeps cursor monotonic for canon scope", () => {
    const db = createTestDb();
    const guildId = "guild-1";
    const sessionId = "session-1";

    insertLedgerEntry(db, {
      id: "a",
      guildId,
      sessionId,
      authorId: "u1",
      authorName: "Alice",
      content: "hello",
      source: "text",
      timestampMs: 1000,
    });
    insertLedgerEntry(db, {
      id: "b",
      guildId,
      sessionId,
      authorId: "u2",
      authorName: "Bob",
      content: "yo",
      source: "voice",
      timestampMs: 1100,
    });

    runHeartbeatAfterLedgerWrite(db, { guildId, sessionId, ledgerEntryId: "b" });

    const row1 = db
      .prepare(`SELECT revision_id, ledger_cursor_id FROM meepo_context WHERE guild_id = ? AND scope = 'canon' AND session_id = ?`)
      .get(guildId, sessionId) as { revision_id: number; ledger_cursor_id: string };
    const block1 = db
      .prepare(`SELECT content FROM meepo_context_blocks WHERE guild_id = ? AND scope = 'canon' AND session_id = ? AND kind = 'raw_lines'`)
      .get(guildId, sessionId) as { content: string };

    expect(row1.ledger_cursor_id).toBe("b");
    expect(row1.revision_id).toBe(1);
    expect(parseRawLines(block1.content)).toHaveLength(2);

    runHeartbeatAfterLedgerWrite(db, { guildId, sessionId, ledgerEntryId: "b" });

    const row2 = db
      .prepare(`SELECT revision_id, ledger_cursor_id FROM meepo_context WHERE guild_id = ? AND scope = 'canon' AND session_id = ?`)
      .get(guildId, sessionId) as { revision_id: number; ledger_cursor_id: string };
    const block2 = db
      .prepare(`SELECT content FROM meepo_context_blocks WHERE guild_id = ? AND scope = 'canon' AND session_id = ? AND kind = 'raw_lines'`)
      .get(guildId, sessionId) as { content: string };

    expect(row2.ledger_cursor_id).toBe("b");
    expect(row2.revision_id).toBe(1);
    expect(parseRawLines(block2.content)).toHaveLength(2);

    insertLedgerEntry(db, {
      id: "c",
      guildId,
      sessionId,
      authorId: "u1",
      authorName: "Alice",
      content: "follow-up",
      source: "text",
      timestampMs: 1200,
    });

    runHeartbeatAfterLedgerWrite(db, { guildId, sessionId, ledgerEntryId: "c" });

    const row3 = db
      .prepare(`SELECT revision_id, ledger_cursor_id FROM meepo_context WHERE guild_id = ? AND scope = 'canon' AND session_id = ?`)
      .get(guildId, sessionId) as { revision_id: number; ledger_cursor_id: string };
    const block3 = db
      .prepare(`SELECT content FROM meepo_context_blocks WHERE guild_id = ? AND scope = 'canon' AND session_id = ? AND kind = 'raw_lines'`)
      .get(guildId, sessionId) as { content: string };

    expect(row3.ledger_cursor_id).toBe("c");
    expect(row3.revision_id).toBe(2);
    expect(parseRawLines(block3.content)).toHaveLength(3);

    runHeartbeatAfterLedgerWrite(db, { guildId, sessionId, ledgerEntryId: "b" });

    const row4 = db
      .prepare(`SELECT revision_id, ledger_cursor_id FROM meepo_context WHERE guild_id = ? AND scope = 'canon' AND session_id = ?`)
      .get(guildId, sessionId) as { revision_id: number; ledger_cursor_id: string };

    expect(row4.ledger_cursor_id).toBe("c");
    expect(row4.revision_id).toBe(2);
  });

  test("stores ambient/system ingestion in separate ambient scope", () => {
    const db = createTestDb();
    const guildId = "guild-1";

    insertLedgerEntry(db, {
      id: "ambient-1",
      guildId,
      sessionId: null,
      authorId: "system",
      authorName: "SYSTEM",
      content: "ambient event",
      source: "system",
      timestampMs: 2000,
    });

    runHeartbeatAfterLedgerWrite(db, { guildId, sessionId: null, ledgerEntryId: "ambient-1" });

    const ambientRow = db
      .prepare(`SELECT scope, session_id, ledger_cursor_id FROM meepo_context WHERE guild_id = ? AND scope = 'ambient'`)
      .get(guildId) as { scope: string; session_id: string; ledger_cursor_id: string };

    expect(ambientRow.scope).toBe("ambient");
    expect(ambientRow.session_id).toBe("__ambient__");
    expect(ambientRow.ledger_cursor_id).toBe("ambient-1");

    const ambientBlock = db
      .prepare(`SELECT content FROM meepo_context_blocks WHERE guild_id = ? AND scope = 'ambient' AND session_id = '__ambient__'`)
      .get(guildId) as { content: string };

    expect(parseRawLines(ambientBlock.content)).toHaveLength(1);
  });
});
