import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";

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
        // best-effort cleanup
      }
    }
  }
});

async function seedSession(guildId: string, sessionId: string): Promise<void> {
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
    "Recap Service Test",
    now - 10_000,
    now - 9_000,
    now - 1_000,
    "test_end",
    "user-1",
    "Tester",
    "live"
  );
}

test("getSessionRecapContract returns canonical source for canonical rows", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-recap-service-canonical-"));
  tempDirs.push(tempDir);
  configureHermeticEnv(tempDir);

  const guildId = "guild-recap-service-canonical";
  const sessionId = "session-recap-service-canonical";
  await seedSession(guildId, sessionId);

  const { upsertSessionRecap } = await import("../sessions/sessionRecaps.js");
  upsertSessionRecap({
    guildId,
    sessionId,
    views: {
      concise: "Concise",
      balanced: "Balanced",
      detailed: "Detailed",
    },
    engine: "megameecap",
    sourceHash: "hash-canonical",
    strategyVersion: "session-recaps-v2",
    metaJson: JSON.stringify({ test: true }),
  });

  const { getSessionRecapContract } = await import("../sessions/recapService.js");
  const contract = getSessionRecapContract({ guildId, sessionId });

  expect(contract).toBeTruthy();
  expect(contract?.source).toBe("canonical");
  expect(contract?.balanced).toBe("Balanced");
  expect(contract?.source_hash).toBe("hash-canonical");
});

test("getSessionRecapContract classifies legacy artifact source when canonical row is missing", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-recap-service-legacy-artifact-"));
  tempDirs.push(tempDir);
  configureHermeticEnv(tempDir);

  const guildId = "guild-recap-service-legacy-artifact";
  const sessionId = "session-recap-service-legacy-artifact";
  await seedSession(guildId, sessionId);

  const { getDbForCampaign } = await import("../db.js");
  const db = getDbForCampaign("default");

  db.prepare(
    `
      INSERT INTO session_artifacts (
        id, session_id, artifact_type, created_at_ms, strategy,
        engine, source_hash, strategy_version, meta_json, content_text
      ) VALUES (?, ?, 'recap_final', ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    `${sessionId}-artifact`,
    sessionId,
    Date.now(),
    "balanced",
    "megameecap",
    "hash-legacy",
    "legacy-artifact-v1",
    JSON.stringify({ legacy: true }),
    "Legacy recap body"
  );

  const { getSessionRecapContract } = await import("../sessions/recapService.js");
  const contract = getSessionRecapContract({ guildId, sessionId });

  expect(contract).toBeTruthy();
  expect(contract?.source).toBe("legacy_artifact");
  expect(contract?.balanced).toBe("Legacy recap body");
  expect(contract?.concise).toBe("");
  expect(contract?.detailed).toBe("");
});

test("getSessionRecapContract classifies legacy meecap source with balanced-only shape", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-recap-service-legacy-meecap-"));
  tempDirs.push(tempDir);
  configureHermeticEnv(tempDir);

  const guildId = "guild-recap-service-legacy-meecap";
  const sessionId = "session-recap-service-legacy-meecap";
  await seedSession(guildId, sessionId);

  const { getDbForCampaign } = await import("../db.js");
  const db = getDbForCampaign("default");
  const now = Date.now();

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
    "Legacy meecap narrative",
    JSON.stringify({ legacy: true })
  );

  const { getSessionRecapContract } = await import("../sessions/recapService.js");
  const contract = getSessionRecapContract({ guildId, sessionId });

  expect(contract).toBeTruthy();
  expect(contract?.source).toBe("legacy_meecap");
  expect(contract?.balanced).toBe("Legacy meecap narrative");
  expect(contract?.concise).toBe("");
  expect(contract?.detailed).toBe("");
});
