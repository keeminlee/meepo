// @ts-nocheck
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { resolveWebAuthContext } from "../../apps/web/lib/server/authContext";
import { WebDataError } from "../../apps/web/lib/mappers/errorMappers";
import { getWebSessionDetail } from "../../apps/web/lib/server/sessionReaders";

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
