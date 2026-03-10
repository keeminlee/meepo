import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import type { RecapStrategy } from "../sessions/recapEngine.js";

const tempDirs: string[] = [];

function configureHermeticEnv(tempDir: string): void {
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
    if (dir) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup on Windows where sqlite WAL handles can linger briefly.
      }
    }
  }
});

async function seedSessionAndLedger(guildId: string, sessionId: string): Promise<void> {
  const { getDbForCampaign } = await import("../db.js");
  const db = getDbForCampaign("default");
  const now = Date.now();

  db.prepare(
    `
      INSERT INTO sessions (
        session_id, guild_id, kind, mode_at_start, status, label,
        created_at_ms, started_at_ms, ended_at_ms, ended_reason,
        started_by_id, started_by_name, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    sessionId,
    guildId,
    "canon",
    "canon",
    "completed",
    "Recap API Test",
    now - 10_000,
    now - 9_000,
    now - 1_000,
    "test_end",
    "user-1",
    "Tester",
    "live"
  );

  db.prepare(
    `
      INSERT INTO ledger_entries (
        id, guild_id, channel_id, message_id, author_id, author_name,
        timestamp_ms, content, content_norm, session_id, tags,
        source, narrative_weight
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    `${sessionId}-entry-1`,
    guildId,
    "channel-1",
    `${sessionId}-msg-1`,
    "user-1",
    "Player",
    now - 8_000,
    "We enter the keep.",
    "We enter the keep.",
    sessionId,
    "human",
    "text",
    "primary"
  );

  db.prepare(
    `
      INSERT INTO ledger_entries (
        id, guild_id, channel_id, message_id, author_id, author_name,
        timestamp_ms, content, content_norm, session_id, tags,
        source, narrative_weight
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    `${sessionId}-entry-2`,
    guildId,
    "channel-1",
    `${sessionId}-msg-2`,
    "user-2",
    "DM",
    now - 7_000,
    "A hidden door opens.",
    "A hidden door opens.",
    sessionId,
    "human",
    "voice",
    "primary"
  );
}

test("sessionRecaps upsert/get round-trip preserves canonical three-view shape", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-session-recaps-api-"));
  tempDirs.push(tempDir);
  configureHermeticEnv(tempDir);

  const guildId = "guild-recaps-api";
  const sessionId = "session-recaps-api";
  await seedSessionAndLedger(guildId, sessionId);

  const { getSessionRecap, upsertSessionRecap } = await import("../sessions/sessionRecaps.js");

  const before = getSessionRecap(guildId, sessionId);
  expect(before).toBeNull();

  const created = upsertSessionRecap({
    guildId,
    sessionId,
    engine: "megameecap",
    sourceHash: "hash-abc",
    strategyVersion: "session-recaps-v2",
    metaJson: JSON.stringify({ run: "run1" }),
    views: {
      concise: "Concise recap",
      balanced: "Balanced recap",
      detailed: "Detailed recap",
    },
  });

  expect(created.sessionId).toBe(sessionId);
  expect(created.views.concise).toBe("Concise recap");
  expect(created.views.balanced).toBe("Balanced recap");
  expect(created.views.detailed).toBe("Detailed recap");

  const loaded = getSessionRecap(guildId, sessionId);
  expect(loaded).toBeTruthy();
  expect(loaded?.views.concise).toBe("Concise recap");
  expect(loaded?.views.balanced).toBe("Balanced recap");
  expect(loaded?.views.detailed).toBe("Detailed recap");
  expect(loaded?.sourceHash).toBe("hash-abc");
});

test("getSessionRecap falls back to legacy session_artifacts recap when canonical row is missing", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-session-recaps-legacy-artifact-"));
  tempDirs.push(tempDir);
  configureHermeticEnv(tempDir);

  const guildId = "guild-recaps-legacy-artifact";
  const sessionId = "session-recaps-legacy-artifact";
  await seedSessionAndLedger(guildId, sessionId);

  const { getDbForCampaign } = await import("../db.js");
  const db = getDbForCampaign("default");
  const now = Date.now();

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_artifacts (
      session_id TEXT,
      artifact_type TEXT,
      content_text TEXT,
      created_at_ms INTEGER,
      engine TEXT,
      source_hash TEXT,
      strategy_version TEXT,
      meta_json TEXT
    )
  `);

  db.prepare(
    `
      INSERT INTO session_artifacts (
        session_id, artifact_type, content_text, created_at_ms,
        engine, source_hash, strategy_version, meta_json
      ) VALUES (?, 'recap_final', ?, ?, ?, ?, ?, ?)
    `
  ).run(
    sessionId,
    "Legacy artifact recap body",
    now,
    "megameecap",
    "hash-legacy-artifact",
    "legacy-artifact-v1",
    JSON.stringify({ legacy: true })
  );

  const { getSessionRecap } = await import("../sessions/sessionRecaps.js");
  const loaded = getSessionRecap(guildId, sessionId);

  expect(loaded).toBeTruthy();
  expect(loaded?.views.concise).toBe("");
  expect(loaded?.views.balanced).toBe("Legacy artifact recap body");
  expect(loaded?.views.detailed).toBe("");
  expect(loaded?.modelVersion).toBe("legacy-artifact-v1");
  expect(loaded?.sourceHash).toBe("hash-legacy-artifact");
});

test("getSessionRecap falls back to legacy meecaps narrative when canonical row is missing", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-session-recaps-legacy-meecap-"));
  tempDirs.push(tempDir);
  configureHermeticEnv(tempDir);

  const guildId = "guild-recaps-legacy-meecap";
  const sessionId = "session-recaps-legacy-meecap";
  await seedSessionAndLedger(guildId, sessionId);

  const { getDbForCampaign } = await import("../db.js");
  const db = getDbForCampaign("default");
  const now = Date.now();

  db.exec(`
    CREATE TABLE IF NOT EXISTS meecaps (
      session_id TEXT,
      created_at_ms INTEGER,
      updated_at_ms INTEGER,
      model TEXT,
      meecap_narrative TEXT,
      meecap_json TEXT
    )
  `);

  db.prepare(
    `
      INSERT INTO meecaps (
        session_id, created_at_ms, updated_at_ms, model, meecap_narrative, meecap_json
      ) VALUES (?, ?, ?, ?, ?, ?)
    `
  ).run(
    sessionId,
    now - 1000,
    now,
    "legacy-model",
    "Legacy meecap narrative body",
    JSON.stringify({ legacy: true })
  );

  const { getSessionRecap } = await import("../sessions/sessionRecaps.js");
  const loaded = getSessionRecap(guildId, sessionId);

  expect(loaded).toBeTruthy();
  expect(loaded?.views.concise).toBe("");
  expect(loaded?.views.balanced).toBe("Legacy meecap narrative body");
  expect(loaded?.views.detailed).toBe("");
  expect(loaded?.modelVersion).toBe("session-recaps-legacy-meecap-v1");
  expect(loaded?.engine).toBe("legacy-model");
});

test("sessionTranscript returns normalized transcript line contract", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-session-transcript-api-"));
  tempDirs.push(tempDir);
  configureHermeticEnv(tempDir);

  const guildId = "guild-transcript-api";
  const sessionId = "session-transcript-api";
  await seedSessionAndLedger(guildId, sessionId);

  const { getSessionTranscript } = await import("../sessions/sessionTranscript.js");

  const transcript = getSessionTranscript({
    guildId,
    sessionId,
    view: "raw",
    primaryOnly: true,
  });

  expect(transcript.guildId).toBe(guildId);
  expect(transcript.sessionId).toBe(sessionId);
  expect(transcript.lineCount).toBeGreaterThan(0);
  expect(transcript.lines[0]?.lineIndex).toBe(0);
  expect(typeof transcript.lines[0]?.speaker).toBe("string");
  expect(typeof transcript.lines[0]?.text).toBe("string");
});

test("generateSessionRecap orchestrates all three styles and persists session_recaps contract", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-session-recaps-generate-"));
  tempDirs.push(tempDir);
  configureHermeticEnv(tempDir);

  const guildId = "guild-recaps-generate";
  const sessionId = "session-recaps-generate";
  await seedSessionAndLedger(guildId, sessionId);

  const {
    generateSessionRecap,
    getSessionRecap,
  } = await import("../sessions/sessionRecaps.js");

  const styleCalls: RecapStrategy[] = [];
  const generated = await generateSessionRecap(
    {
      guildId,
      sessionId,
    },
    {
      generateStyleRecap: async ({ strategy }) => {
        styleCalls.push(strategy);
        return {
          text: `${strategy.toUpperCase()} recap output`,
          createdAtMs: Date.now(),
          strategy,
          engine: "megameecap",
          strategyVersion: "megameecap-final-v1",
          baseVersion: "megameecap-base-v1",
          finalVersion: "megameecap-final-v1",
          sourceTranscriptHash: `hash-${strategy}`,
          cacheHit: false,
          artifactPaths: {
            recapPath: `${strategy}.md`,
            metaPath: `${strategy}.json`,
          },
          sourceRange: {
            startLine: 0,
            endLine: 2,
            lineCount: 3,
          },
        };
      },
    }
  );

  expect(styleCalls).toEqual(["concise", "balanced", "detailed"]);
  expect(generated.views.concise).toContain("CONCISE");
  expect(generated.views.balanced).toContain("BALANCED");
  expect(generated.views.detailed).toContain("DETAILED");
  expect(generated.generatedAt).toBeGreaterThan(0);
  expect(generated.modelVersion).toBe("megameecap-final-v1");

  const loaded = getSessionRecap(guildId, sessionId);
  expect(loaded).toBeTruthy();
  expect(loaded?.views.concise).toContain("CONCISE");
  expect(loaded?.views.balanced).toContain("BALANCED");
  expect(loaded?.views.detailed).toContain("DETAILED");
  expect(loaded?.modelVersion).toBe("megameecap-final-v1");
});

test("regenerateSessionRecap overwrites safely and records regeneration reason", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-session-recaps-regenerate-"));
  tempDirs.push(tempDir);
  configureHermeticEnv(tempDir);

  const guildId = "guild-recaps-regenerate";
  const sessionId = "session-recaps-regenerate";
  await seedSessionAndLedger(guildId, sessionId);

  const {
    generateSessionRecap,
    regenerateSessionRecap,
    getSessionRecap,
  } = await import("../sessions/sessionRecaps.js");

  await generateSessionRecap(
    { guildId, sessionId },
    {
      generateStyleRecap: async ({ strategy }) => ({
        text: `v1-${strategy}`,
        createdAtMs: Date.now(),
        strategy,
        engine: "megameecap",
        strategyVersion: "megameecap-final-v1",
        baseVersion: "megameecap-base-v1",
        finalVersion: "megameecap-final-v1",
        sourceTranscriptHash: "hash-v1",
        cacheHit: false,
        artifactPaths: {
          recapPath: `${strategy}-v1.md`,
          metaPath: `${strategy}-v1.json`,
        },
      }),
    }
  );

  const regenerated = await regenerateSessionRecap(
    { guildId, sessionId, reason: "manual_qc" },
    {
      generateStyleRecap: async ({ strategy }) => ({
        text: `v2-${strategy}`,
        createdAtMs: Date.now() + 1,
        strategy,
        engine: "megameecap",
        strategyVersion: "megameecap-final-v1",
        baseVersion: "megameecap-base-v1",
        finalVersion: "megameecap-final-v1",
        sourceTranscriptHash: "hash-v2",
        cacheHit: false,
        artifactPaths: {
          recapPath: `${strategy}-v2.md`,
          metaPath: `${strategy}-v2.json`,
        },
      }),
    }
  );

  expect(regenerated.views.balanced).toBe("v2-balanced");
  const loaded = getSessionRecap(guildId, sessionId);
  expect(loaded?.views.concise).toBe("v2-concise");
  expect(loaded?.views.balanced).toBe("v2-balanced");
  expect(loaded?.views.detailed).toBe("v2-detailed");
  expect(loaded?.metaJson).toContain("manual_qc");
});

test("repeated generateSessionRecap preserves createdAt and overwrites stored views predictably", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-session-recaps-repeat-generate-"));
  tempDirs.push(tempDir);
  configureHermeticEnv(tempDir);

  const guildId = "guild-recaps-repeat";
  const sessionId = "session-recaps-repeat";
  await seedSessionAndLedger(guildId, sessionId);

  const {
    generateSessionRecap,
    getSessionRecap,
  } = await import("../sessions/sessionRecaps.js");

  const first = await generateSessionRecap(
    { guildId, sessionId },
    {
      generateStyleRecap: async ({ strategy }) => ({
        text: `first-${strategy}`,
        createdAtMs: Date.now(),
        strategy,
        engine: "megameecap",
        strategyVersion: "megameecap-final-v1",
        baseVersion: "megameecap-base-v1",
        finalVersion: "megameecap-final-v1",
        sourceTranscriptHash: "hash-first",
        cacheHit: false,
        artifactPaths: {
          recapPath: `${strategy}-first.md`,
          metaPath: `${strategy}-first.json`,
        },
      }),
    }
  );

  const second = await generateSessionRecap(
    { guildId, sessionId },
    {
      generateStyleRecap: async ({ strategy }) => ({
        text: `second-${strategy}`,
        createdAtMs: Date.now() + 10,
        strategy,
        engine: "megameecap",
        strategyVersion: "megameecap-final-v1",
        baseVersion: "megameecap-base-v1",
        finalVersion: "megameecap-final-v1",
        sourceTranscriptHash: "hash-second",
        cacheHit: false,
        artifactPaths: {
          recapPath: `${strategy}-second.md`,
          metaPath: `${strategy}-second.json`,
        },
      }),
    }
  );

  expect(second.createdAtMs).toBe(first.createdAtMs);
  expect(second.updatedAtMs).toBeGreaterThanOrEqual(first.updatedAtMs);
  expect(second.views.concise).toBe("second-concise");
  expect(second.views.balanced).toBe("second-balanced");
  expect(second.views.detailed).toBe("second-detailed");

  const loaded = getSessionRecap(guildId, sessionId);
  expect(loaded?.createdAtMs).toBe(first.createdAtMs);
  expect(loaded?.views.concise).toBe("second-concise");
  expect(loaded?.views.balanced).toBe("second-balanced");
  expect(loaded?.views.detailed).toBe("second-detailed");
});

test("generateSessionRecap maps missing transcript and invalid output to typed recap-domain errors", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-session-recaps-errors-"));
  tempDirs.push(tempDir);
  configureHermeticEnv(tempDir);

  const guildId = "guild-recaps-errors";
  const sessionId = "session-recaps-errors";
  await seedSessionAndLedger(guildId, sessionId);

  const {
    generateSessionRecap,
    RecapDomainError,
    isRecapDomainError,
  } = await import("../sessions/sessionRecaps.js");

  await expect(
    generateSessionRecap(
      { guildId, sessionId },
      {
        generateStyleRecap: async () => {
          throw new Error(`No transcript lines found for session ${sessionId}`);
        },
      }
    )
  ).rejects.toMatchObject({
    code: "RECAP_TRANSCRIPT_UNAVAILABLE",
  });

  await expect(
    generateSessionRecap(
      { guildId, sessionId },
      {
        generateStyleRecap: async ({ strategy }) => ({
          text: strategy === "balanced" ? "   " : `${strategy}-ok`,
          createdAtMs: Date.now(),
          strategy,
          engine: "megameecap",
          strategyVersion: "megameecap-final-v1",
          baseVersion: "megameecap-base-v1",
          finalVersion: "megameecap-final-v1",
          sourceTranscriptHash: "hash-invalid",
          cacheHit: false,
          artifactPaths: {
            recapPath: `${strategy}.md`,
            metaPath: `${strategy}.json`,
          },
        }),
      }
    )
  ).rejects.toMatchObject({
    code: "RECAP_INVALID_OUTPUT",
  });

  const error = new RecapDomainError("RECAP_GENERATION_FAILED", "boom");
  expect(isRecapDomainError(error)).toBe(true);
  expect(isRecapDomainError(new Error("plain"))).toBe(false);
});
