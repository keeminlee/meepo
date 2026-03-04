import Database from "better-sqlite3";
import { describe, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runHeartbeatAfterLedgerWrite } from "../ledger/meepoContextHeartbeat.js";
import { processOneMeepoContextAction } from "../ledger/meepoContextActions.js";
import { claimNextAction } from "../ledger/meepoContextRepo.js";

vi.mock("../llm/client.js", () => ({
  chat: vi.fn(async () => "mock llm output"),
}));

vi.mock("../config/env.js", () => ({
  cfg: {
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

    CREATE TABLE sessions (
      session_id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      label TEXT
    );
  `);
  return db;
}

function insertLedgerEntry(db: any, args: {
  id: string;
  guildId: string;
  sessionId: string;
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

describe("meepo context action queue", () => {
  test("compacts canon context at 250 lines with replay-safe dedupe", async () => {
    const db = createTestDb();
    const guildId = "guild-1";
    const sessionId = "session-1";

    db.prepare(`INSERT INTO sessions (session_id, guild_id, label) VALUES (?, ?, ?)`)
      .run(sessionId, guildId, "C2E20");

    for (let i = 1; i <= 250; i += 1) {
      insertLedgerEntry(db, {
        id: `line-${String(i).padStart(3, "0")}`,
        guildId,
        sessionId,
        authorId: i % 2 === 0 ? "u2" : "u1",
        authorName: i % 2 === 0 ? "Bob" : "Alice",
        content: `line ${i}`,
        source: "text",
        timestampMs: 1_000 + i,
      });
    }

    runHeartbeatAfterLedgerWrite(db, {
      guildId,
      sessionId,
      ledgerEntryId: "line-250",
    });

    const contextRow = db
      .prepare(
        `SELECT ledger_cursor_id, canon_line_cursor_total, canon_line_cursor_watermark
         FROM meepo_context
         WHERE guild_id = ? AND scope = 'canon' AND session_id = ?`
      )
      .get(guildId, sessionId) as {
      ledger_cursor_id: string;
      canon_line_cursor_total: number;
      canon_line_cursor_watermark: number;
    };

    expect(contextRow.ledger_cursor_id).toBe("line-250");
    expect(contextRow.canon_line_cursor_total).toBe(250);
    expect(contextRow.canon_line_cursor_watermark).toBe(0);

    const actions = db
      .prepare(`SELECT action_type, status, dedupe_key FROM meepo_actions ORDER BY created_at_ms ASC`)
      .all() as Array<{ action_type: string; status: string; dedupe_key: string }>;
    expect(actions).toHaveLength(2);
    expect(actions.map((a) => a.action_type).sort()).toEqual([
      "compact-mini-meecap",
      "megameecap-update-chunk",
    ]);
    expect(actions[0]?.status).toBe("pending");

    await processOneMeepoContextAction(db, "test-worker");

    const watermarkAfterProcessing = (db.prepare(
      `SELECT canon_line_cursor_watermark AS watermark
       FROM meepo_context
       WHERE guild_id = ? AND scope = 'canon' AND session_id = ?`
    ).get(guildId, sessionId) as { watermark: number }).watermark;
    expect(watermarkAfterProcessing).toBe(250);

    const miniCount = (db.prepare(
      `SELECT COUNT(*) AS n FROM meepo_context_blocks
       WHERE guild_id = ? AND scope = 'canon' AND session_id = ? AND kind = 'mini_meecap'`
    ).get(guildId, sessionId) as { n: number }).n;

    const receiptCount = (db.prepare(
      `SELECT COUNT(*) AS n FROM meepo_context_blocks
       WHERE guild_id = ? AND scope = 'canon' AND session_id = ? AND kind = 'receipt'`
    ).get(guildId, sessionId) as { n: number }).n;

    expect(miniCount).toBe(1);
    expect(receiptCount).toBeGreaterThanOrEqual(1);

    runHeartbeatAfterLedgerWrite(db, {
      guildId,
      sessionId,
      ledgerEntryId: "line-250",
    });

    const actionsAfterReplay = (db.prepare(`SELECT COUNT(*) AS n FROM meepo_actions`).get() as { n: number }).n;
    const miniAfterReplay = (db.prepare(
      `SELECT COUNT(*) AS n FROM meepo_context_blocks
       WHERE guild_id = ? AND scope = 'canon' AND session_id = ? AND kind = 'mini_meecap'`
    ).get(guildId, sessionId) as { n: number }).n;

    expect(actionsAfterReplay).toBe(2);
    expect(miniAfterReplay).toBe(1);

    db.prepare(
      `UPDATE meepo_actions
       SET status = 'done', lease_owner = NULL, lease_until_ms = NULL
       WHERE action_type = 'megameecap-update-chunk'`
    ).run();

    db.prepare(
      `INSERT INTO meepo_actions (
         id, guild_id, scope, session_id, action_type, dedupe_key, payload_json,
         status, lease_owner, lease_until_ms, attempts, last_error, created_at_ms, updated_at_ms, completed_at_ms
       ) VALUES (?, ?, 'canon', ?, 'compact-mini-meecap', ?, ?, 'pending', NULL, NULL, 0, NULL, ?, ?, NULL)`
    ).run(
      randomUUID(),
      guildId,
      sessionId,
      `manual:${Date.now()}`,
      JSON.stringify({
        guild_id: guildId,
        scope: "canon",
        session_id: sessionId,
        start_line: 1,
        end_line: 250,
      }),
      Date.now(),
      Date.now()
    );

    db.prepare(
      `UPDATE meepo_context
       SET canon_line_cursor_watermark = 0
       WHERE guild_id = ? AND scope = 'canon' AND session_id = ?`
    ).run(guildId, sessionId);

    const processed = await processOneMeepoContextAction(db, "test-worker");
    expect(processed).toBe(true);

    const watermarkAfterReplay = (db.prepare(
      `SELECT canon_line_cursor_watermark AS watermark
       FROM meepo_context
       WHERE guild_id = ? AND scope = 'canon' AND session_id = ?`
    ).get(guildId, sessionId) as { watermark: number }).watermark;
    expect(watermarkAfterReplay).toBe(250);

    const miniAfterManual = (db.prepare(
      `SELECT COUNT(*) AS n FROM meepo_context_blocks
       WHERE guild_id = ? AND scope = 'canon' AND session_id = ? AND kind = 'mini_meecap'`
    ).get(guildId, sessionId) as { n: number }).n;
    expect(miniAfterManual).toBe(1);
  });

  test("claims actions with lease ownership and allows expired lease takeover", () => {
    const db = createTestDb();
    const now = 10_000;

    db.prepare(
      `INSERT INTO meepo_actions (
         id, guild_id, scope, session_id, action_type, dedupe_key, payload_json,
         status, lease_owner, lease_until_ms, attempts, last_error, created_at_ms, updated_at_ms, completed_at_ms
       ) VALUES (?, 'guild-1', 'canon', 'session-1', 'compact-mini-meecap', 'd1', '{}', 'pending', NULL, NULL, 0, NULL, ?, ?, NULL)`
    ).run("action-1", now, now);

    const firstClaim = claimNextAction(db, {
      leaseOwner: "worker-a",
      leaseMs: 5_000,
      nowMs: now,
    });
    expect(firstClaim?.id).toBe("action-1");
    expect(firstClaim?.status).toBe("processing");
    expect(firstClaim?.lease_owner).toBe("worker-a");

    const secondClaim = claimNextAction(db, {
      leaseOwner: "worker-b",
      leaseMs: 5_000,
      nowMs: now + 100,
    });
    expect(secondClaim).toBeNull();

    db.prepare(
      `UPDATE meepo_actions
       SET status = 'processing', lease_owner = 'worker-a', lease_until_ms = ?
       WHERE id = ?`
    ).run(now - 1, "action-1");

    const takeover = claimNextAction(db, {
      leaseOwner: "worker-b",
      leaseMs: 5_000,
      nowMs: now + 200,
    });

    expect(takeover?.id).toBe("action-1");
    expect(takeover?.lease_owner).toBe("worker-b");
    expect(takeover?.attempts).toBe(2);
  });

  test("megameecap-update-chunk logs exactly one llm_prompt_dispatch per attempt", async () => {
    const previousLoggingEnabled = process.env.MEEPO_ACTION_LOGGING_ENABLED;
    const previousForceActionLogs = process.env.MEEPO_FORCE_ACTION_LOGS;
    const previousDispatchOverride = process.env.MEEPO_TEST_ENABLE_LLM_DISPATCH_LOG;
    const previousArtifactDir = process.env.MEEPO_HEARTBEAT_REPLAY_ARTIFACT_DIR;
    const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-action-dispatch-"));

    process.env.MEEPO_ACTION_LOGGING_ENABLED = "1";
    process.env.MEEPO_FORCE_ACTION_LOGS = "1";
    process.env.MEEPO_TEST_ENABLE_LLM_DISPATCH_LOG = "1";
    process.env.MEEPO_HEARTBEAT_REPLAY_ARTIFACT_DIR = artifactDir;

    try {
      const db = createTestDb();
      const guildId = "guild-1";
      const sessionId = "session-dispatch";

      db.prepare(`INSERT INTO sessions (session_id, guild_id, label) VALUES (?, ?, ?)`)
        .run(sessionId, guildId, "C2E21");

      for (let i = 1; i <= 250; i += 1) {
        insertLedgerEntry(db, {
          id: `line-${String(i).padStart(3, "0")}`,
          guildId,
          sessionId,
          authorId: i % 2 === 0 ? "u2" : "u1",
          authorName: i % 2 === 0 ? "Bob" : "Alice",
          content: `dispatch test line ${i}`,
          source: "text",
          timestampMs: 10_000 + i,
        });
      }

      runHeartbeatAfterLedgerWrite(db, {
        guildId,
        sessionId,
        ledgerEntryId: "line-250",
      });

      for (let i = 0; i < 4; i += 1) {
        const processed = await processOneMeepoContextAction(db, "test-worker");
        if (!processed) break;
      }

      const jsonlName = fs
        .readdirSync(artifactDir)
        .find((name) => name.endsWith("-meepo-actions-online.jsonl"));
      expect(jsonlName).toBeTruthy();

      const rows = fs
        .readFileSync(path.join(artifactDir, jsonlName!), "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { event_type?: string; data?: { action_type?: string; attempt?: number } });

      const dispatchRows = rows.filter((row) =>
        row.event_type === "llm_prompt_dispatch"
        && row.data?.action_type === "megameecap-update-chunk"
        && row.data?.attempt === 1
      );

      expect(dispatchRows).toHaveLength(1);
    } finally {
      if (previousLoggingEnabled === undefined) delete process.env.MEEPO_ACTION_LOGGING_ENABLED;
      else process.env.MEEPO_ACTION_LOGGING_ENABLED = previousLoggingEnabled;

      if (previousForceActionLogs === undefined) delete process.env.MEEPO_FORCE_ACTION_LOGS;
      else process.env.MEEPO_FORCE_ACTION_LOGS = previousForceActionLogs;

      if (previousDispatchOverride === undefined) delete process.env.MEEPO_TEST_ENABLE_LLM_DISPATCH_LOG;
      else process.env.MEEPO_TEST_ENABLE_LLM_DISPATCH_LOG = previousDispatchOverride;

      if (previousArtifactDir === undefined) delete process.env.MEEPO_HEARTBEAT_REPLAY_ARTIFACT_DIR;
      else process.env.MEEPO_HEARTBEAT_REPLAY_ARTIFACT_DIR = previousArtifactDir;

      fs.rmSync(artifactDir, { recursive: true, force: true });
    }
  });
});
