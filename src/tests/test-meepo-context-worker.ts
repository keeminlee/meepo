import Database from "better-sqlite3";
import { beforeAll, describe, expect, test, vi } from "vitest";

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
    features: {
      contextInlineActionsDev: false,
      contextWorkerEnabled: true,
      contextMiniFirst: false,
    },
    meepoContextActions: {
      pollMs: 100,
      maxActionsPerTick: 4,
      maxTotalRuntimeMs: 1000,
      leaseTtlMs: 30_000,
      maxAttempts: 4,
      retryBaseMs: 10,
    },
  },
}));

let claimNextAction: typeof import("../ledger/meepoContextRepo.js").claimNextAction;
let getMeepoContextQueueStatus: typeof import("../ledger/meepoContextActions.js").getMeepoContextQueueStatus;
let processMeepoContextActionsTick: typeof import("../ledger/meepoContextActions.js").processMeepoContextActionsTick;

beforeAll(async () => {
  ({ claimNextAction } = await import("../ledger/meepoContextRepo.js"));
  ({ getMeepoContextQueueStatus, processMeepoContextActionsTick } = await import("../ledger/meepoContextActions.js"));
});

function createDb(): any {
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
  `);
  return db;
}

describe("meepo context worker controls", () => {
  test("lease expiry allows re-lease after ttl", () => {
    const db = createDb();
    const now = 50_000;

    db.prepare(
      `INSERT INTO meepo_actions (
         id, guild_id, scope, session_id, action_type, dedupe_key, payload_json,
         status, lease_owner, lease_until_ms, attempts, last_error, created_at_ms, updated_at_ms, completed_at_ms
       ) VALUES ('a1', 'g1', 'canon', 's1', 'compact-mini-meecap', 'd1', '{}', 'pending', NULL, NULL, 0, NULL, ?, ?, NULL)`
    ).run(now, now);

    const first = claimNextAction(db, {
      leaseOwner: "w1",
      leaseMs: 1000,
      nowMs: now,
    });
    expect(first?.id).toBe("a1");

    const blocked = claimNextAction(db, {
      leaseOwner: "w2",
      leaseMs: 1000,
      nowMs: now + 200,
    });
    expect(blocked).toBeNull();

    const rel = claimNextAction(db, {
      leaseOwner: "w2",
      leaseMs: 1000,
      nowMs: now + 1500,
    });
    expect(rel?.id).toBe("a1");
    expect(rel?.lease_owner).toBe("w2");
  });

  test("max-actions-per-tick is respected", async () => {
    const db = createDb();
    const now = Date.now();

    for (let i = 1; i <= 3; i += 1) {
      db.prepare(
        `INSERT INTO meepo_actions (
           id, guild_id, scope, session_id, action_type, dedupe_key, payload_json,
           status, lease_owner, lease_until_ms, attempts, last_error, created_at_ms, updated_at_ms, completed_at_ms
         ) VALUES (?, 'g1', 'canon', 's1', 'unknown-action', ?, '{}', 'pending', NULL, NULL, 0, NULL, ?, ?, NULL)`
      ).run(`a${i}`, `d${i}`, now + i, now + i);
    }

    const result = await processMeepoContextActionsTick(db, "worker", {
      maxActionsPerTick: 1,
      maxTotalRuntimeMs: 500,
      leaseTtlMs: 30_000,
      maxAttempts: 4,
      retryBaseMs: 500,
    });

    expect(result.processed).toBe(1);
    const row = db.prepare(`SELECT COUNT(*) AS n FROM meepo_actions WHERE status = 'pending'`).get() as { n: number };
    expect(row.n).toBe(3);
  });

  test("queue status counts match seeded rows", () => {
    const db = createDb();
    const now = Date.now();

    db.prepare(
      `INSERT INTO meepo_actions (id, guild_id, scope, session_id, action_type, dedupe_key, payload_json, status, lease_owner, lease_until_ms, attempts, last_error, created_at_ms, updated_at_ms, completed_at_ms)
       VALUES ('q1', 'g1', 'canon', 's1', 'compact-mini-meecap', 'dq1', '{}', 'pending', NULL, NULL, 0, NULL, ?, ?, NULL)`
    ).run(now - 1000, now - 1000);

    db.prepare(
      `INSERT INTO meepo_actions (id, guild_id, scope, session_id, action_type, dedupe_key, payload_json, status, lease_owner, lease_until_ms, attempts, last_error, created_at_ms, updated_at_ms, completed_at_ms)
       VALUES ('l1', 'g1', 'canon', 's1', 'compact-mini-meecap', 'dl1', '{}', 'processing', 'w1', ?, 1, NULL, ?, ?, NULL)`
    ).run(now + 20_000, now - 900, now - 900);

    db.prepare(
      `INSERT INTO meepo_actions (id, guild_id, scope, session_id, action_type, dedupe_key, payload_json, status, lease_owner, lease_until_ms, attempts, last_error, created_at_ms, updated_at_ms, completed_at_ms)
       VALUES ('f1', 'g1', 'canon', 's1', 'compact-mini-meecap', 'df1', '{}', 'failed', NULL, NULL, 4, 'err', ?, ?, NULL)`
    ).run(now - 800, now - 800);

    db.prepare(
      `INSERT INTO meepo_actions (id, guild_id, scope, session_id, action_type, dedupe_key, payload_json, status, lease_owner, lease_until_ms, attempts, last_error, created_at_ms, updated_at_ms, completed_at_ms)
       VALUES ('d1', 'g1', 'canon', 's1', 'compact-mini-meecap', 'dd1', '{}', 'done', NULL, NULL, 1, NULL, ?, ?, ?)`
    ).run(now - 700, now - 100, now - 100);

    const status = getMeepoContextQueueStatus(db);
    expect(status.queuedCount).toBe(1);
    expect(status.leasedCount).toBe(1);
    expect(status.failedCount).toBe(1);
    expect((status.oldestQueuedAgeMs ?? 0) >= 900).toBe(true);
    expect(status.lastCompletedAtMs).toBe(now - 100);
  });
});
