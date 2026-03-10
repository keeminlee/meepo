// @ts-nocheck
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, test, vi } from "vitest";
import { resolveWebAuthContext } from "../../apps/web/lib/server/authContext";
import { WebDataError } from "../../apps/web/lib/mappers/errorMappers";
import { getWebSessionDetail } from "../../apps/web/lib/server/sessionReaders";
import { findSessionByGuildAndId, listSessionsForGuildCampaign } from "../../apps/web/lib/server/readData/archiveReadStore";

process.env.DISCORD_TOKEN ??= "test-token";
process.env.OPENAI_API_KEY ??= "test-openai-key";

const tempDirs: string[] = [];

vi.mock("../../apps/web/lib/server/authContext", async () => {
  const actual = await vi.importActual<typeof import("../../apps/web/lib/server/authContext")>(
    "../../apps/web/lib/server/authContext"
  );
  return {
    ...actual,
    resolveWebAuthContext: vi.fn(),
  };
});

function configureHermeticEnv(tempDir: string): void {
  vi.stubEnv("DATA_ROOT", tempDir);
  vi.stubEnv("DATA_CAMPAIGNS_DIR", "campaigns");
  vi.stubEnv("DATA_DB_FILENAME", "db.sqlite");
  vi.stubEnv("MIGRATIONS_SILENT", "1");
  vi.stubEnv("DEFAULT_CAMPAIGN_SLUG", "default");
}

async function setAuthGuilds(guildIds: string[]): Promise<void> {
  const mocked = vi.mocked(resolveWebAuthContext);
  mocked.mockResolvedValue({
    kind: "authenticated",
    source: "session_snapshot",
    user: { id: "user-1", name: "Tester", globalName: "Tester" },
    authorizedGuildIds: guildIds,
    authorizedGuilds: guildIds.map((id) => ({ id, name: `Guild ${id}` })),
    primaryGuildId: guildIds[0] ?? null,
    devBypass: false,
  } as any);
}

async function upsertSessionInCampaignDb(args: {
  guildId: string;
  campaignSlug: string;
  sessionId: string;
  startedAtMs: number;
}): Promise<void> {
  const { getDbForCampaign } = await import("../db.js");
  const db = getDbForCampaign(args.campaignSlug);
  db.prepare(
    `INSERT OR REPLACE INTO sessions (
      session_id, guild_id, kind, mode_at_start, status, label,
      started_at_ms, started_by_id, source, created_at_ms
    ) VALUES (?, ?, 'canon', 'canon', 'completed', ?, ?, ?, 'live', ?)`
  ).run(
    args.sessionId,
    args.guildId,
    `Session ${args.guildId}`,
    args.startedAtMs,
    `dm-${args.guildId}`,
    args.startedAtMs
  );
  db.close();
}

function buildScopedCampaignDir(root: string, guildId: string, campaignSlug: string): string {
  return path.join(root, "campaigns", `g_${guildId.toLowerCase()}__c_${campaignSlug.toLowerCase()}`);
}

function buildLegacyCampaignDir(root: string, campaignSlug: string): string {
  return path.join(root, "campaigns", campaignSlug);
}

function createSessionsDb(args: { dbPath: string; withGuildColumn: boolean }): Database.Database {
  fs.mkdirSync(path.dirname(args.dbPath), { recursive: true });
  const db = new Database(args.dbPath);

  if (args.withGuildColumn) {
    db.exec(
      `CREATE TABLE sessions (
        session_id TEXT PRIMARY KEY,
        guild_id TEXT,
        status TEXT,
        label TEXT,
        started_at_ms INTEGER,
        started_by_id TEXT,
        source TEXT
      );`
    );
  } else {
    db.exec(
      `CREATE TABLE sessions (
        session_id TEXT PRIMARY KEY,
        status TEXT,
        label TEXT,
        started_at_ms INTEGER,
        started_by_id TEXT,
        source TEXT
      );`
    );
  }

  return db;
}

function insertSessionWithGuild(db: Database.Database, args: { sessionId: string; guildId: string; startedAtMs: number }): void {
  db.prepare(
    `INSERT INTO sessions (session_id, guild_id, status, label, started_at_ms, started_by_id, source)
     VALUES (?, ?, 'completed', ?, ?, 'dm-user', 'live')`
  ).run(args.sessionId, args.guildId, `Session ${args.sessionId}`, args.startedAtMs);
}

function insertSessionLegacy(db: Database.Database, args: { sessionId: string; startedAtMs: number }): void {
  db.prepare(
    `INSERT INTO sessions (session_id, status, label, started_at_ms, started_by_id, source)
     VALUES (?, 'completed', ?, ?, 'dm-user', 'live')`
  ).run(args.sessionId, `Session ${args.sessionId}`, args.startedAtMs);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore transient file lock cleanup on Windows.
    }
  }
});

describe("web session scope disambiguation", () => {
  test("returns ambiguity error when a session id exists in multiple authorized guild scopes", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-web-scope-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const { ensureGuildConfig, setGuildCampaignSlug, setGuildMetaCampaignSlug } = await import("../campaign/guildConfig.js");
    const { createShowtimeCampaign } = await import("../campaign/showtimeCampaigns.js");
    const { getDbForCampaign } = await import("../db.js");

    // Ensure control DB/migrations are initialized.
    const bootstrapDb = getDbForCampaign("default");
    bootstrapDb.close();

    ensureGuildConfig("guild-1", "Guild One");
    ensureGuildConfig("guild-2", "Guild Two");

    const campaign1 = createShowtimeCampaign({ guildId: "guild-1", campaignName: "Alpha One", createdByUserId: "dm-1" });
    const campaign2 = createShowtimeCampaign({ guildId: "guild-2", campaignName: "Beta Two", createdByUserId: "dm-2" });

    setGuildCampaignSlug("guild-1", campaign1.campaign_slug);
    setGuildCampaignSlug("guild-2", campaign2.campaign_slug);
    setGuildMetaCampaignSlug("guild-1", campaign1.campaign_slug);
    setGuildMetaCampaignSlug("guild-2", campaign2.campaign_slug);

    const sharedSessionId = "session-shared-001";
    await upsertSessionInCampaignDb({
      guildId: "guild-1",
      campaignSlug: campaign1.campaign_slug,
      sessionId: sharedSessionId,
      startedAtMs: Date.now() - 1_000,
    });
    await upsertSessionInCampaignDb({
      guildId: "guild-2",
      campaignSlug: campaign2.campaign_slug,
      sessionId: sharedSessionId,
      startedAtMs: Date.now(),
    });

    await setAuthGuilds(["guild-1", "guild-2"]);

    await expect(getWebSessionDetail({ sessionId: sharedSessionId })).rejects.toMatchObject({
      code: "ambiguous_session_scope",
      status: 409,
    } satisfies Partial<WebDataError>);
  });

  test("resolves session scope with explicit guild_id disambiguator", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-web-scope-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const { ensureGuildConfig, setGuildCampaignSlug, setGuildMetaCampaignSlug } = await import("../campaign/guildConfig.js");
    const { createShowtimeCampaign } = await import("../campaign/showtimeCampaigns.js");
    const { getDbForCampaign } = await import("../db.js");

    const bootstrapDb = getDbForCampaign("default");
    bootstrapDb.close();

    ensureGuildConfig("guild-1", "Guild One");
    ensureGuildConfig("guild-2", "Guild Two");

    const campaign1 = createShowtimeCampaign({ guildId: "guild-1", campaignName: "Alpha One", createdByUserId: "dm-1" });
    const campaign2 = createShowtimeCampaign({ guildId: "guild-2", campaignName: "Beta Two", createdByUserId: "dm-2" });

    setGuildCampaignSlug("guild-1", campaign1.campaign_slug);
    setGuildCampaignSlug("guild-2", campaign2.campaign_slug);
    setGuildMetaCampaignSlug("guild-1", campaign1.campaign_slug);
    setGuildMetaCampaignSlug("guild-2", campaign2.campaign_slug);

    const sharedSessionId = "session-shared-002";
    await upsertSessionInCampaignDb({
      guildId: "guild-1",
      campaignSlug: campaign1.campaign_slug,
      sessionId: sharedSessionId,
      startedAtMs: Date.now() - 2_000,
    });
    await upsertSessionInCampaignDb({
      guildId: "guild-2",
      campaignSlug: campaign2.campaign_slug,
      sessionId: sharedSessionId,
      startedAtMs: Date.now() - 1_000,
    });

    await setAuthGuilds(["guild-1", "guild-2"]);

    const detail = await getWebSessionDetail({
      sessionId: sharedSessionId,
      searchParams: { guild_id: "guild-2" },
    });

    expect(detail.id).toBe(sharedSessionId);
    expect(detail.guildId).toBe("guild-2");
    expect(detail.campaignSlug).toBe(campaign2.campaign_slug);
  });

  test("does not fall back to other campaigns when campaign_slug hint is provided", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-web-scope-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const { ensureGuildConfig, setGuildCampaignSlug, setGuildMetaCampaignSlug } = await import("../campaign/guildConfig.js");
    const { createShowtimeCampaign } = await import("../campaign/showtimeCampaigns.js");
    const { getDbForCampaign } = await import("../db.js");

    const bootstrapDb = getDbForCampaign("default");
    bootstrapDb.close();

    ensureGuildConfig("guild-1", "Guild One");

    const alpha = createShowtimeCampaign({ guildId: "guild-1", campaignName: "Alpha One", createdByUserId: "dm-1" });
    const beta = createShowtimeCampaign({ guildId: "guild-1", campaignName: "Beta Two", createdByUserId: "dm-1" });
    setGuildCampaignSlug("guild-1", alpha.campaign_slug);
    setGuildMetaCampaignSlug("guild-1", alpha.campaign_slug);

    const sessionId = "session-hinted-001";
    await upsertSessionInCampaignDb({
      guildId: "guild-1",
      campaignSlug: alpha.campaign_slug,
      sessionId,
      startedAtMs: Date.now(),
    });

    await setAuthGuilds(["guild-1"]);

    await expect(
      getWebSessionDetail({
        sessionId,
        searchParams: { guild_id: "guild-1", campaign_slug: beta.campaign_slug },
      })
    ).rejects.toMatchObject({ code: "not_found", status: 404 } satisfies Partial<WebDataError>);
  });
});

describe("archive read-store fallback policy", () => {
  test("uses same-campaign legacy DB when scoped DB is empty", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-web-read-fallback-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const scoped = createSessionsDb({
      dbPath: path.join(buildScopedCampaignDir(tempDir, "guild-1", "alpha"), "db.sqlite"),
      withGuildColumn: true,
    });
    scoped.close();

    const legacy = createSessionsDb({
      dbPath: path.join(buildLegacyCampaignDir(tempDir, "alpha"), "db.sqlite"),
      withGuildColumn: true,
    });
    insertSessionWithGuild(legacy, { sessionId: "legacy-s1", guildId: "guild-1", startedAtMs: Date.now() });
    legacy.close();

    const rows = listSessionsForGuildCampaign({ guildId: "guild-1", campaignSlug: "alpha", limit: 20 });
    expect(rows.length).toBe(1);
    expect(rows[0]?.session_id).toBe("legacy-s1");
  });

  test("uses schema-compat query when sessions table has no guild_id column", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-web-read-fallback-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const legacy = createSessionsDb({
      dbPath: path.join(buildLegacyCampaignDir(tempDir, "alpha"), "db.sqlite"),
      withGuildColumn: false,
    });
    insertSessionLegacy(legacy, { sessionId: "legacy-no-guild", startedAtMs: Date.now() });
    legacy.close();

    const rows = listSessionsForGuildCampaign({ guildId: "guild-1", campaignSlug: "alpha", limit: 20 });
    expect(rows.length).toBe(1);
    expect(rows[0]?.session_id).toBe("legacy-no-guild");
    expect(rows[0]?.guild_id).toBe("guild-1");

    const found = findSessionByGuildAndId({ guildId: "guild-1", campaignSlug: "alpha", sessionId: "legacy-no-guild" });
    expect(found?.session_id).toBe("legacy-no-guild");
    expect(found?.guild_id).toBe("guild-1");
  });

  test("matches whitespace-polluted guild_id rows via trim-safe comparison", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-web-read-fallback-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const scoped = createSessionsDb({
      dbPath: path.join(buildScopedCampaignDir(tempDir, "guild-1", "alpha"), "db.sqlite"),
      withGuildColumn: true,
    });
    insertSessionWithGuild(scoped, { sessionId: "trimmed-s1", guildId: " guild-1 ", startedAtMs: Date.now() });
    scoped.close();

    const rows = listSessionsForGuildCampaign({ guildId: "guild-1", campaignSlug: "alpha", limit: 20 });
    expect(rows.length).toBe(1);
    expect(rows[0]?.session_id).toBe("trimmed-s1");

    const found = findSessionByGuildAndId({ guildId: "guild-1", campaignSlug: "alpha", sessionId: "trimmed-s1" });
    expect(found?.session_id).toBe("trimmed-s1");
  });

  test("does not bleed scoped wrong-guild rows and still recovers same-campaign legacy rows", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-web-read-fallback-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const scoped = createSessionsDb({
      dbPath: path.join(buildScopedCampaignDir(tempDir, "guild-1", "alpha"), "db.sqlite"),
      withGuildColumn: true,
    });
    insertSessionWithGuild(scoped, { sessionId: "scoped-wrong-guild", guildId: "guild-2", startedAtMs: Date.now() - 5000 });
    scoped.close();

    const legacy = createSessionsDb({
      dbPath: path.join(buildLegacyCampaignDir(tempDir, "alpha"), "db.sqlite"),
      withGuildColumn: true,
    });
    insertSessionWithGuild(legacy, { sessionId: "legacy-correct-guild", guildId: "guild-1", startedAtMs: Date.now() });
    legacy.close();

    const rows = listSessionsForGuildCampaign({ guildId: "guild-1", campaignSlug: "alpha", limit: 20 });
    expect(rows.length).toBe(1);
    expect(rows[0]?.session_id).toBe("legacy-correct-guild");
    expect(rows[0]?.guild_id).toBe("guild-1");

    const wrongGuild = findSessionByGuildAndId({ guildId: "guild-1", campaignSlug: "alpha", sessionId: "scoped-wrong-guild" });
    expect(wrongGuild).toBeNull();

    const correctGuild = findSessionByGuildAndId({ guildId: "guild-1", campaignSlug: "alpha", sessionId: "legacy-correct-guild" });
    expect(correctGuild?.session_id).toBe("legacy-correct-guild");
  });
});
