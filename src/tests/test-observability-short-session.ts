import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { runHeartbeatAfterLedgerWrite } from "../ledger/meepoContextHeartbeat.js";
import { processOneMeepoContextAction } from "../ledger/meepoContextActions.js";
import { loadMeepoContextSnapshot } from "../recall/loadMeepoContextSnapshot.js";
import { buildMeepoPromptBundle } from "../llm/buildMeepoPromptBundle.js";
import { resolveMeepoActionLogPaths } from "../ledger/meepoActionLogging.js";

vi.mock("../config/env.js", () => ({
  cfg: {
    data: {
      root: "./data",
      campaignsDir: "campaigns",
    },
    llm: {
      model: "mock-model",
      voiceContextMs: 60_000,
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
      contextMiniFirst: false,
    },
    meepoContextActions: {
      leaseTtlMs: 30_000,
      maxAttempts: 4,
      retryBaseMs: 500,
    },
  },
}));

vi.mock("../db.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db.js")>();
  return {
    ...actual,
    getDbForCampaign: vi.fn(),
    getControlDb: vi.fn(),
  };
});

vi.mock("../ledger/meepoMindRetrievalArtifacts.js", () => ({
  computeRetrievalQueryHash: (queryText?: string) =>
    createHash("sha256").update((queryText ?? "").trim().toLowerCase(), "utf8").digest("hex"),
  buildRetrievalArtifactPath: (args: {
    campaignSlug: string;
    sessionId: string;
    anchorLedgerId: string;
    algoVersion: string;
    topK: number;
    queryHash: string;
  }) => {
    const dataRoot = process.env.DATA_ROOT ?? ".";
    return path.join(
      dataRoot,
      "campaigns",
      args.campaignSlug,
      "exports",
      "meecaps",
      "online",
      args.sessionId,
      "retrieval",
      `mind_${args.anchorLedgerId}_${args.algoVersion}_${args.topK}_${args.queryHash.slice(0, 8)}.json`
    );
  },
  loadRetrievalArtifact: ({ artifactPath }: { artifactPath: string }) => {
    if (!fs.existsSync(artifactPath)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
      if (parsed?.kind !== "meepo_mind_retrieval") return null;
      return parsed;
    } catch {
      return null;
    }
  },
}));

vi.mock("../ledger/meepoMindRetrieveAction.js", () => ({
  executeMeepoMindRetrieveAction: vi.fn((payload: any) => {
    const dataRoot = process.env.DATA_ROOT ?? ".";
    const shortQueryHash = String(payload.query_hash ?? "").slice(0, 8);
    const artifactPath = path.join(
      dataRoot,
      "campaigns",
      String(payload.campaign_slug ?? "default"),
      "exports",
      "meecaps",
      "online",
      String(payload.session_id),
      "retrieval",
      `mind_${String(payload.anchor_ledger_id)}_${String(payload.algo_version)}_${String(payload.top_k)}_${shortQueryHash}.json`
    );

    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(
      artifactPath,
      JSON.stringify(
        {
          schema_version: 1,
          kind: "meepo_mind_retrieval",
          campaign_slug: payload.campaign_slug,
          session_id: payload.session_id,
          anchor_ledger_id: payload.anchor_ledger_id,
          created_at_ms: Date.now(),
          algo_version: payload.algo_version,
          query_hash: payload.query_hash,
          top_k: payload.top_k,
          always: {
            criteria: {
              gravity: 1.0,
              certainty: 1.0,
              resilience: 1.0,
            },
            memories: [
              {
                memory_id: "always-1",
                title: "Core",
                text: "Always remember this",
                score: 1,
                tags: [],
                source: "meepomind_db",
              },
            ],
          },
          ranked: {
            memories: [
              {
                memory_id: "ranked-1",
                title: "Relevant",
                text: "Relevant memory",
                score: 0.5,
                tags: [],
                source: "meepomind_db",
              },
            ],
          },
          stats: {
            always_count: 1,
            ranked_count: 1,
            db_ms: 1,
          },
        },
        null,
        2
      ),
      "utf8"
    );

    return {
      artifactPath,
      alwaysCount: 1,
      rankedCount: 1,
      dbMs: 1,
    };
  }),
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

    CREATE TABLE guild_config (
      guild_id TEXT PRIMARY KEY,
      campaign_slug TEXT NOT NULL,
      dm_user_id TEXT,
      dm_role_id TEXT,
      default_persona_id TEXT,
      setup_version INTEGER,
      home_text_channel_id TEXT,
      home_voice_channel_id TEXT,
      canon_persona_mode TEXT,
      canon_persona_id TEXT,
      default_recap_style TEXT
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

describe("observability short session", () => {
  const prevDataRoot = process.env.DATA_ROOT;
  const prevLogScopes = process.env.LOG_SCOPES;
  const prevActionLogging = process.env.MEEPO_ACTION_LOGGING_ENABLED;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-observability-"));

  afterEach(() => {
    vi.clearAllMocks();
    if (prevDataRoot === undefined) delete process.env.DATA_ROOT;
    else process.env.DATA_ROOT = prevDataRoot;

    if (prevLogScopes === undefined) delete process.env.LOG_SCOPES;
    else process.env.LOG_SCOPES = prevLogScopes;

    if (prevActionLogging === undefined) delete process.env.MEEPO_ACTION_LOGGING_ENABLED;
    else process.env.MEEPO_ACTION_LOGGING_ENABLED = prevActionLogging;

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test("logs heartbeat + context/prompt transition for same anchor", async () => {
    process.env.DATA_ROOT = tempRoot;
    process.env.LOG_SCOPES = "meepo_actions";
    process.env.MEEPO_ACTION_LOGGING_ENABLED = "1";

    const db = createTestDb();
    const { getDbForCampaign, getControlDb } = await import("../db.js");
    vi.mocked(getDbForCampaign).mockReturnValue(db as any);
    vi.mocked(getControlDb).mockReturnValue(db as any);

    const guildId = "guild-1";
    const sessionId = "session-observe-1";
    const campaignSlug = "default";

    db.prepare(`INSERT INTO guild_config (guild_id, campaign_slug) VALUES (?, ?)`)
      .run(guildId, campaignSlug);
    db.prepare(`INSERT INTO sessions (session_id, guild_id, label) VALUES (?, ?, ?)`)
      .run(sessionId, guildId, "C2E-SHORT");

    const entries = [
      { id: "line-1", authorId: "u1", authorName: "Alice", content: "hello meepo" },
      { id: "line-2", authorId: "meepo", authorName: "Meepo", content: "meep" },
      { id: "line-3", authorId: "u1", authorName: "Alice", content: "remember the bridge" },
      { id: "line-4", authorId: "meepo", authorName: "Meepo", content: "noted" },
      { id: "line-5", authorId: "u1", authorName: "Alice", content: "what happened there?" },
      { id: "line-6", authorId: "meepo", authorName: "Meepo", content: "thinking" },
    ] as const;

    for (let index = 0; index < entries.length; index += 1) {
      const item = entries[index]!;
      insertLedgerEntry(db, {
        id: item.id,
        guildId,
        sessionId,
        authorId: item.authorId,
        authorName: item.authorName,
        content: item.content,
        source: "text",
        timestampMs: 10_000 + index,
      });
    }

    runHeartbeatAfterLedgerWrite(db, {
      guildId,
      sessionId,
      ledgerEntryId: "line-6",
      runKind: "online",
    });

    const anchorLedgerId = "line-5";
    const snapshot = await loadMeepoContextSnapshot({
      guildId,
      sessionId,
      anchorLedgerId,
      windowMs: 300_000,
      limit: 20,
    });

    const persona = {
      id: "diegetic_meepo",
      displayName: "Meepo",
      scope: "campaign",
      systemGuardrails: "guard",
      identity: "identity",
      speechStyle: "style",
      personalityTone: "tone",
      styleGuard: "sg",
      styleSpec: {
        name: "Meepo",
        voice: "gentle",
        punctuation: "low",
        caps: "never",
      },
    } as const;

    const firstBundle = buildMeepoPromptBundle({
      guild_id: guildId,
      campaign_slug: campaignSlug,
      session_id: sessionId,
      anchor_ledger_id: anchorLedgerId,
      user_text: "what do you remember about the bridge?",
      meepo_context_snapshot: { context: snapshot.context },
      persona,
    });
    expect(Boolean(firstBundle.retrieval)).toBe(false);

    for (let i = 0; i < 3; i += 1) {
      const processed = await processOneMeepoContextAction(db, "test-worker", {
        leaseTtlMs: 30_000,
        maxAttempts: 4,
        retryBaseMs: 100,
        runKind: "online",
      });
      if (!processed) break;
    }

    const secondBundle = buildMeepoPromptBundle({
      guild_id: guildId,
      campaign_slug: campaignSlug,
      session_id: sessionId,
      anchor_ledger_id: anchorLedgerId,
      user_text: "what do you remember about the bridge?",
      meepo_context_snapshot: { context: snapshot.context },
      persona,
    });
    expect(Boolean(secondBundle.retrieval)).toBe(true);

    const { jsonlPath } = resolveMeepoActionLogPaths(db, {
      guildId,
      sessionId,
      runKind: "online",
    });
    expect(fs.existsSync(jsonlPath)).toBe(true);

    const rows = fs
      .readFileSync(jsonlPath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, any>);

    expect(rows.some((row) => String(row.event ?? row.event_type) === "heartbeat-tick")).toBe(true);
    expect(
      rows.some((row) =>
        String(row.event ?? row.event_type) === "action-enqueued"
        && String(row.data?.action_type ?? "") === "meepo-mind-retrieve"
      )
    ).toBe(true);
    expect(
      rows.some((row) =>
        String(row.event ?? row.event_type) === "context-snapshot-built"
        && String(row.anchor_ledger_id ?? "") === anchorLedgerId
      )
    ).toBe(true);

    const promptRows = rows.filter((row) =>
      String(row.event ?? row.event_type) === "prompt-bundle-built"
      && String(row.anchor_ledger_id ?? "") === anchorLedgerId
    );
    expect(promptRows.length).toBeGreaterThanOrEqual(2);

    const firstPrompt = promptRows[0]!;
    const secondPrompt = promptRows[1]!;
    expect(String(firstPrompt.anchor_ledger_id)).toBe(anchorLedgerId);
    expect(Boolean(firstPrompt.data?.has_retrieval)).toBe(false);
    expect(String(secondPrompt.anchor_ledger_id)).toBe(anchorLedgerId);
    expect(Boolean(secondPrompt.data?.has_retrieval)).toBe(true);

    const retrievalDone = rows.find((row) => String(row.event ?? row.event_type) === "RETRIEVAL_DONE");
    const retrievalArtifactPath = String(retrievalDone?.data?.artifact_path ?? "");
    expect(retrievalArtifactPath).toBeTruthy();
    expect(fs.existsSync(retrievalArtifactPath)).toBe(true);

    const enqueuedIndex = rows.findIndex((row) =>
      String(row.event ?? row.event_type) === "action-enqueued"
      && String(row.data?.action_type ?? "") === "meepo-mind-retrieve"
    );
    const retrievalDoneIndex = rows.findIndex((row) => String(row.event ?? row.event_type) === "RETRIEVAL_DONE");
    const secondPromptIndex = rows.findIndex((row) =>
      String(row.event ?? row.event_type) === "prompt-bundle-built"
      && String(row.anchor_ledger_id ?? "") === anchorLedgerId
      && Boolean(row.data?.has_retrieval)
    );

    expect(enqueuedIndex).toBeGreaterThanOrEqual(0);
    expect(retrievalDoneIndex).toBeGreaterThan(enqueuedIndex);
    expect(secondPromptIndex).toBeGreaterThan(retrievalDoneIndex);
  });
});
