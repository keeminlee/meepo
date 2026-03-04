import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, test, vi } from "vitest";
import { resolveSessionRow, runReplayOnDb } from "./replay.js";

vi.mock("../../config/env.js", () => ({
  cfg: {
    data: {
      root: path.join(os.tmpdir(), "meepo-replay-tests"),
      campaignsDir: "campaigns",
    },
    db: {
      path: path.join(os.tmpdir(), "meepo-replay-tests", "bot.sqlite"),
      filename: "campaign.sqlite",
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
    meepoActionLogging: {
      enabled: true,
      includePromptBodies: false,
    },
  },
}));

vi.mock("../../llm/client.js", () => ({
  chat: vi.fn(async () => "mock-llm-output"),
}));

function hashFile(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function createTestDb(): any {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE sessions (
      session_id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'canon',
      label TEXT,
      created_at_ms INTEGER NOT NULL DEFAULT 0
    );

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
  `);
  return db;
}

function seedSession(db: any, args: { guildId: string; sessionId: string; label: string }): void {
  db.prepare(
    `INSERT INTO sessions (session_id, guild_id, kind, label, created_at_ms)
     VALUES (?, ?, 'canon', ?, ?)`
  ).run(args.sessionId, args.guildId, args.label, Date.now());
}

function seedLedger(db: any, args: { guildId: string; sessionId: string; count: number; startIndex?: number }): void {
  const startIndex = args.startIndex ?? 1;
  for (let i = 0; i < args.count; i += 1) {
    const n = startIndex + i;
    db.prepare(
      `INSERT INTO ledger_entries (id, guild_id, session_id, author_id, author_name, content, source, timestamp_ms)
       VALUES (?, ?, ?, ?, ?, ?, 'text', ?)`
    ).run(
      `line-${String(n).padStart(4, "0")}`,
      args.guildId,
      args.sessionId,
      "u1",
      "Alice",
      `line ${n}`,
      1_000 + n,
    );
  }
}

const tempRoots: string[] = [];

process.env.MEEPO_ACTION_LOGGING_ENABLED = "true";
process.env.MEEPO_ACTION_LOGGING_INCLUDE_PROMPTS = "false";

afterEach(() => {
  for (const root of tempRoots.splice(0, tempRoots.length)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  delete process.env.MEEPO_HEARTBEAT_REPLAY_ARTIFACT_DIR;
});

function mkTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

const workerTickOptions = {
  maxActionsPerTick: 4,
  maxTotalRuntimeMs: 500,
  leaseTtlMs: 30_000,
  maxAttempts: 4,
  retryBaseMs: 10,
};

describe("heartbeat replay tool", () => {
  test("resolves --session by label/name (latest created) and by id", () => {
    const db = createTestDb();
    db.prepare(
      `INSERT INTO sessions (session_id, guild_id, kind, label, created_at_ms)
       VALUES ('s-old', 'g1', 'canon', 'C2E20', 1000),
              ('s-new', 'g1', 'canon', 'C2E20', 2000),
              ('s-exact', 'g1', 'canon', 'C2E21', 1500)`
    ).run();

    const byLabel = resolveSessionRow(db, "C2E20");
    expect(byLabel.session_id).toBe("s-new");

    const byId = resolveSessionRow(db, "s-exact");
    expect(byId.session_id).toBe("s-exact");
  });

  test("replay small session: no chunk enqueue, cursor matches expected", async () => {
    const db = createTestDb();
    seedSession(db, { guildId: "g1", sessionId: "s1", label: "C2E1" });
    seedLedger(db, { guildId: "g1", sessionId: "s1", count: 20 });

    const summary = await runReplayOnDb({
      db,
      guildId: "g1",
      sessionId: "s1",
      execute: false,
      workerTickOptions,
    });

    expect(summary.ledgerProcessed).toBe(20);
    expect(summary.finalCursor).toBe("line-0020");
    expect(summary.finalWatermark).toBe(0);
    expect(summary.queueDepth).toBe(0);
  });

  test("replay threshold-crossing session: exactly one chunk action enqueued", async () => {
    const db = createTestDb();
    seedSession(db, { guildId: "g1", sessionId: "s1", label: "C2E20" });
    seedLedger(db, { guildId: "g1", sessionId: "s1", count: 250 });

    await runReplayOnDb({
      db,
      guildId: "g1",
      sessionId: "s1",
      execute: false,
      workerTickOptions,
    });

    const chunkQueued = (db.prepare(
      `SELECT COUNT(*) AS n
       FROM meepo_actions
       WHERE session_id = 's1' AND action_type = 'megameecap-update-chunk'`
    ).get() as { n: number }).n;

    expect(chunkQueued).toBe(1);
  });

  test("replay with execute writes artifacts and advances watermark", async () => {
    const prevLogScopes = process.env.LOG_SCOPES;
    const prevForceActionLogs = process.env.MEEPO_FORCE_ACTION_LOGS;
    process.env.LOG_SCOPES = "meepo_actions";
    process.env.MEEPO_FORCE_ACTION_LOGS = "true";
    try {
      const db = createTestDb();
      seedSession(db, { guildId: "g1", sessionId: "s1", label: "C2E20" });
      seedLedger(db, { guildId: "g1", sessionId: "s1", count: 250 });

      const artifactDir = mkTempDir("meepo-replay-artifacts-");
      process.env.MEEPO_HEARTBEAT_REPLAY_ARTIFACT_DIR = artifactDir;

      const summary = await runReplayOnDb({
        db,
        guildId: "g1",
        sessionId: "s1",
        execute: true,
        artifactOutputDir: artifactDir,
        workerTickOptions,
      });

      const files = fs.readdirSync(artifactDir).sort((a, b) => a.localeCompare(b));
      expect(files.some((name) => name.includes("megameecap-chunk") && name.endsWith(".md"))).toBe(true);
      expect(files.some((name) => name.includes("megameecap-base") && name.endsWith(".md"))).toBe(true);
      expect(files.some((name) => name.includes("recap-final-balanced") && name.endsWith(".md"))).toBe(true);
      expect(files.some((name) => name.endsWith(".meta.json"))).toBe(true);
      const offlineJsonl = files.find((name) => name.endsWith("-meepo-actions-offline-replay.jsonl"));
      const offlineLog = files.find((name) => name.endsWith("-meepo-actions-offline-replay.log"));
      expect(offlineJsonl).toBeTruthy();
      expect(offlineLog).toBeTruthy();
      const mergedLog = fs.readFileSync(path.join(artifactDir, offlineLog!), "utf8");
      expect(mergedLog.includes("[Lline-0250]")).toBe(true);

      const actionDone = (db.prepare(
        `SELECT COUNT(*) AS n FROM meepo_actions WHERE status = 'done'`
      ).get() as { n: number }).n;

      expect(actionDone).toBeGreaterThanOrEqual(2);
      expect(summary.finalWatermark).toBe(250);
      expect(summary.queueDepth).toBe(0);
      expect(summary.artifactsWritten.length).toBeGreaterThan(0);
    } finally {
      if (prevLogScopes === undefined) delete process.env.LOG_SCOPES;
      else process.env.LOG_SCOPES = prevLogScopes;
      if (prevForceActionLogs === undefined) delete process.env.MEEPO_FORCE_ACTION_LOGS;
      else process.env.MEEPO_FORCE_ACTION_LOGS = prevForceActionLogs;
    }
  });

  test("replay execute drains all chunk ranges progressively", async () => {
    const db = createTestDb();
    seedSession(db, { guildId: "g1", sessionId: "s1", label: "C2E20" });
    seedLedger(db, { guildId: "g1", sessionId: "s1", count: 750 });

    const artifactDir = mkTempDir("meepo-replay-progressive-drain-");
    process.env.MEEPO_HEARTBEAT_REPLAY_ARTIFACT_DIR = artifactDir;

    const summary = await runReplayOnDb({
      db,
      guildId: "g1",
      sessionId: "s1",
      execute: true,
      artifactOutputDir: artifactDir,
      workerTickOptions,
    });

    const chunkDone = (db.prepare(
      `SELECT COUNT(*) AS n
       FROM meepo_actions
       WHERE session_id = 's1'
         AND action_type = 'megameecap-update-chunk'
         AND status = 'done'`
    ).get() as { n: number }).n;

    expect(chunkDone).toBe(3);
    expect(summary.finalWatermark).toBe(750);
    expect(summary.queueDepth).toBe(0);
  });

  test("replay twice is idempotent: no duplicate actions or artifact rewrites", async () => {
    const db = createTestDb();
    seedSession(db, { guildId: "g1", sessionId: "s1", label: "C2E20" });
    seedLedger(db, { guildId: "g1", sessionId: "s1", count: 250 });

    const artifactDir = mkTempDir("meepo-replay-idempotent-");
    process.env.MEEPO_HEARTBEAT_REPLAY_ARTIFACT_DIR = artifactDir;

    await runReplayOnDb({
      db,
      guildId: "g1",
      sessionId: "s1",
      execute: true,
      artifactOutputDir: artifactDir,
      workerTickOptions,
    });

    const beforeFiles = fs.readdirSync(artifactDir)
      .filter((name) => name.endsWith(".md") || name.endsWith(".json"))
      .map((name) => path.join(artifactDir, name))
      .sort((a, b) => a.localeCompare(b));
    const beforeHashes = new Map(beforeFiles.map((filePath) => [filePath, hashFile(filePath)]));

    const summary2 = await runReplayOnDb({
      db,
      guildId: "g1",
      sessionId: "s1",
      execute: true,
      artifactOutputDir: artifactDir,
      workerTickOptions,
    });

    const chunkActions = (db.prepare(
      `SELECT COUNT(*) AS n FROM meepo_actions WHERE action_type = 'megameecap-update-chunk'`
    ).get() as { n: number }).n;
    expect(chunkActions).toBe(1);
    expect(summary2.artifactsWritten).toEqual([]);

    const afterFiles = fs.readdirSync(artifactDir)
      .filter((name) => name.endsWith(".md") || name.endsWith(".json"))
      .map((name) => path.join(artifactDir, name))
      .sort((a, b) => a.localeCompare(b));
    const afterHashes = new Map(afterFiles.map((filePath) => [filePath, hashFile(filePath)]));

    expect(afterFiles).toEqual(beforeFiles);
    for (const [filePath, hash] of beforeHashes.entries()) {
      expect(afterHashes.get(filePath)).toBe(hash);
    }
  });

  test("replay after watermark present processes only new entries", async () => {
    const db = createTestDb();
    seedSession(db, { guildId: "g1", sessionId: "s1", label: "C2E20" });
    seedLedger(db, { guildId: "g1", sessionId: "s1", count: 250 });

    const artifactDir = mkTempDir("meepo-replay-new-entries-");
    process.env.MEEPO_HEARTBEAT_REPLAY_ARTIFACT_DIR = artifactDir;

    await runReplayOnDb({
      db,
      guildId: "g1",
      sessionId: "s1",
      execute: true,
      artifactOutputDir: artifactDir,
      workerTickOptions,
    });

    seedLedger(db, { guildId: "g1", sessionId: "s1", count: 50, startIndex: 251 });

    const summary = await runReplayOnDb({
      db,
      guildId: "g1",
      sessionId: "s1",
      execute: false,
      workerTickOptions,
    });

    const context = db.prepare(
      `SELECT canon_line_cursor_total AS total, canon_line_cursor_watermark AS watermark
       FROM meepo_context
       WHERE guild_id = 'g1' AND scope = 'canon' AND session_id = 's1'`
    ).get() as { total: number; watermark: number };

    expect(summary.finalCursor).toBe("line-0300");
    expect(context.total).toBe(300);
    expect(context.watermark).toBe(250);
  });
});
