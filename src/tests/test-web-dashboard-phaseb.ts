// @ts-nocheck
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { getWebDashboardModel } from "../../apps/web/lib/server/campaignReaders";
import { resolveWebAuthContext } from "../../apps/web/lib/server/authContext";

process.env.DISCORD_TOKEN ??= "test-token";
process.env.OPENAI_API_KEY ??= "test-openai-key";

type MockAuthContext = {
  kind: "authenticated" | "fallback";
  source: "session_snapshot" | "discord_refresh" | "session_snapshot_fallback" | "header" | "query";
  user: { id: string; name: string | null; globalName: string | null } | null;
  authorizedGuildIds: string[];
  authorizedGuilds: Array<{ id: string; name?: string; iconUrl?: string }>;
  primaryGuildId: string | null;
  devBypass: boolean;
};

const tempDirs: string[] = [];

vi.mock("../../apps/web/lib/server/authContext", async () => {
  const actual = await vi.importActual<typeof import("../../apps/web/lib/server/authContext")>("../../apps/web/lib/server/authContext");
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
  await setAuthGuildsDetailed(guildIds.map((id) => ({ id, name: `Guild ${id}` })));
}

async function setAuthGuildsDetailed(
  guilds: Array<{ id: string; name?: string; iconUrl?: string }>,
  userId = "user-1"
): Promise<void> {
  const mocked = vi.mocked(resolveWebAuthContext);
  const guildIds = guilds.map((guild) => guild.id);
  const context: MockAuthContext = {
    kind: "authenticated",
    source: "session_snapshot",
    user: { id: userId, name: "Tester", globalName: "Tester" },
    authorizedGuildIds: guildIds,
    authorizedGuilds: guilds,
    primaryGuildId: guildIds[0] ?? null,
    devBypass: false,
  };
  mocked.mockResolvedValue(context as any);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore transient Windows file-lock cleanup issues.
      }
    }
  }
});

describe("web dashboard Phase B state engine", () => {
  test("returns signed_in_no_meepo_installed when guild has no config or campaigns", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-web-phaseb-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    await setAuthGuilds(["guild-1"]);

    const { getDbForCampaign } = await import("../db.js");
    const db = getDbForCampaign("default");

    const model = await getWebDashboardModel();
    expect(model.authState).toBe("signed_in_no_meepo_installed");
    expect(model.totalSessions).toBe(0);

    db.close();
  });

  test("returns signed_in_no_sessions when guild config exists without awaken state", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-web-phaseb-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    await setAuthGuilds(["guild-1"]);

    const { getDbForCampaign } = await import("../db.js");
    const { ensureGuildConfig } = await import("../campaign/guildConfig.js");
    const db = getDbForCampaign("default");
    ensureGuildConfig("guild-1", "Guild One");

    const model = await getWebDashboardModel();
    expect(model.authState).toBe("signed_in_no_sessions");

    db.close();
  });

  test("returns signed_in_no_sessions when awakened and no showtime sessions", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-web-phaseb-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    await setAuthGuilds(["guild-1"]);

    const { getDbForCampaign } = await import("../db.js");
    const { ensureGuildConfig, setGuildAwakened, setGuildMetaCampaignSlug } = await import("../campaign/guildConfig.js");
    const db = getDbForCampaign("default");
    const cfg = ensureGuildConfig("guild-1", "Guild One");
    setGuildMetaCampaignSlug("guild-1", cfg.campaign_slug);
    setGuildAwakened("guild-1", true);

    const model = await getWebDashboardModel();
    expect(model.authState).toBe("signed_in_no_sessions");
    expect(model.totalSessions).toBe(0);

    db.close();
  });

  test("treats canonical awakened=true as awakened even when meta campaign slug is null", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-web-phaseb-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    await setAuthGuilds(["guild-1"]);

    const { getDbForCampaign } = await import("../db.js");
    const { ensureGuildConfig, setGuildAwakened, setGuildMetaCampaignSlug } = await import("../campaign/guildConfig.js");
    const db = getDbForCampaign("default");

    ensureGuildConfig("guild-1", "Guild One");
    setGuildAwakened("guild-1", true);
    setGuildMetaCampaignSlug("guild-1", null);

    const model = await getWebDashboardModel();
    expect(model.authState).toBe("signed_in_no_sessions");

    db.close();
  });

  test("returns ok and includes both active and completed sessions in dashboard summaries", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-web-phaseb-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    await setAuthGuilds(["guild-1"]);

    const { getDbForCampaign } = await import("../db.js");
    const { ensureGuildConfig, setGuildAwakened, setGuildMetaCampaignSlug, setGuildCampaignSlug } = await import("../campaign/guildConfig.js");
    const { createShowtimeCampaign } = await import("../campaign/showtimeCampaigns.js");
    const { startSession, endSession } = await import("../sessions/sessions.js");
    const db = getDbForCampaign("default");

    const cfg = ensureGuildConfig("guild-1", "Guild One");
    setGuildAwakened("guild-1", true);
    setGuildMetaCampaignSlug("guild-1", cfg.campaign_slug);

    const campaign = createShowtimeCampaign({
      guildId: "guild-1",
      campaignName: "Campaign Alpha",
      createdByUserId: "dm-user",
    });
    setGuildCampaignSlug("guild-1", campaign.campaign_slug);

    // Session 1: completed.
    startSession("guild-1", "dm-user", "DM", { source: "live", kind: "canon", modeAtStart: "canon" });
    endSession("guild-1", "showtime_end");

    // Session 2: active.
    startSession("guild-1", "dm-user", "DM", { source: "live", kind: "canon", modeAtStart: "canon" });

    const model = await getWebDashboardModel();
    expect(model.authState).toBe("ok");
    expect(model.totalSessions).toBeGreaterThanOrEqual(2);

    const statuses = model.campaigns.flatMap((campaign: any) => campaign.sessions.map((session: any) => session.status));
    expect(statuses).toContain("in_progress");
    expect(statuses).toContain("completed");

    db.close();
  });

  test("keeps campaign visible when configured slug matches meta campaign slug", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-web-phaseb-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    await setAuthGuilds(["guild-1"]);

    const { getDbForCampaign } = await import("../db.js");
    const { ensureGuildConfig, setGuildAwakened, setGuildMetaCampaignSlug, setGuildCampaignSlug } = await import("../campaign/guildConfig.js");
    const { createShowtimeCampaign } = await import("../campaign/showtimeCampaigns.js");
    const { startSession } = await import("../sessions/sessions.js");
    const db = getDbForCampaign("default");

    ensureGuildConfig("guild-1", "Guild One");
    setGuildAwakened("guild-1", true);

    const campaign = createShowtimeCampaign({
      guildId: "guild-1",
      campaignName: "homebrew_campaign_2",
      createdByUserId: "dm-user",
    });

    setGuildCampaignSlug("guild-1", campaign.campaign_slug);
    setGuildMetaCampaignSlug("guild-1", campaign.campaign_slug);
    startSession("guild-1", "dm-user", "DM", { source: "live", kind: "canon", modeAtStart: "canon" });

    const model = await getWebDashboardModel();
    expect(model.authState).toBe("ok");
    expect(model.campaigns.some((item: any) => item.slug === campaign.campaign_slug)).toBe(true);

    db.close();
  });

  test("dashboard model lists only authorized guild scope", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-web-phaseb-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    await setAuthGuilds(["guild-1"]);

    const { getDbForCampaign } = await import("../db.js");
    const { ensureGuildConfig, setGuildAwakened, setGuildMetaCampaignSlug, setGuildCampaignSlug } = await import("../campaign/guildConfig.js");
    const { createShowtimeCampaign } = await import("../campaign/showtimeCampaigns.js");
    const { startSession } = await import("../sessions/sessions.js");

    const db = getDbForCampaign("default");

    const guildOneCfg = ensureGuildConfig("guild-1", "Guild One");
    setGuildAwakened("guild-1", true);
    setGuildMetaCampaignSlug("guild-1", guildOneCfg.campaign_slug);
    const guildOneCampaign = createShowtimeCampaign({ guildId: "guild-1", campaignName: "Guild One Alpha", createdByUserId: "dm-1" });
    setGuildCampaignSlug("guild-1", guildOneCampaign.campaign_slug);
    startSession("guild-1", "dm-1", "DM One", { source: "live", kind: "canon", modeAtStart: "canon" });

    const guildTwoCfg = ensureGuildConfig("guild-2", "Guild Two");
    setGuildAwakened("guild-2", true);
    setGuildMetaCampaignSlug("guild-2", guildTwoCfg.campaign_slug);
    const guildTwoCampaign = createShowtimeCampaign({ guildId: "guild-2", campaignName: "Guild Two Alpha", createdByUserId: "dm-2" });
    setGuildCampaignSlug("guild-2", guildTwoCampaign.campaign_slug);
    startSession("guild-2", "dm-2", "DM Two", { source: "live", kind: "canon", modeAtStart: "canon" });

    const model = await getWebDashboardModel();
    expect(model.authState).toBe("ok");
    expect(model.campaigns.length).toBeGreaterThan(0);
    expect(model.campaigns.every((campaign) => campaign.guildId === "guild-1")).toBe(true);

    db.close();
  });

  test("dashboard model resolves durable guild display metadata when present", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-web-phaseb-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    await setAuthGuildsDetailed([{ id: "guild-1", name: "Moonwell Syndicate", iconUrl: "https://cdn.test/guild-1.png" }]);

    const { getDbForCampaign } = await import("../db.js");
    const { ensureGuildConfig, setGuildCampaignSlug } = await import("../campaign/guildConfig.js");
    const { createShowtimeCampaign } = await import("../campaign/showtimeCampaigns.js");
    const { startSession } = await import("../sessions/sessions.js");

    const db = getDbForCampaign("default");
    ensureGuildConfig("guild-1", "Guild One");
    const campaign = createShowtimeCampaign({ guildId: "guild-1", campaignName: "Alpha", createdByUserId: "dm-1" });
    setGuildCampaignSlug("guild-1", campaign.campaign_slug);
    startSession("guild-1", "dm-1", "DM One", { source: "live", kind: "canon", modeAtStart: "canon" });

    const model = await getWebDashboardModel();
    expect(model.authState).toBe("ok");
    expect(model.campaigns.length).toBeGreaterThan(0);
    expect(model.campaigns[0]?.guildName).toBe("Moonwell Syndicate");
    expect(model.campaigns[0]?.guildIconUrl).toBe("https://cdn.test/guild-1.png");

    db.close();
  });

  test("dashboard model falls back to guild_id when guild metadata is missing", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-web-phaseb-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    await setAuthGuildsDetailed([{ id: "guild-1" }]);

    const { getDbForCampaign } = await import("../db.js");
    const { ensureGuildConfig, setGuildCampaignSlug } = await import("../campaign/guildConfig.js");
    const { createShowtimeCampaign } = await import("../campaign/showtimeCampaigns.js");
    const { startSession } = await import("../sessions/sessions.js");

    const db = getDbForCampaign("default");
    ensureGuildConfig("guild-1", "Guild One");
    const campaign = createShowtimeCampaign({ guildId: "guild-1", campaignName: "Alpha", createdByUserId: "dm-1" });
    setGuildCampaignSlug("guild-1", campaign.campaign_slug);
    startSession("guild-1", "dm-1", "DM One", { source: "live", kind: "canon", modeAtStart: "canon" });

    const model = await getWebDashboardModel();
    expect(model.authState).toBe("ok");
    expect(model.campaigns.length).toBeGreaterThan(0);
    expect(model.campaigns[0]?.guildName).toBe("guild-1");
    expect(model.campaigns[0]?.guildIconUrl ?? null).toBeNull();

    db.close();
  });

  test("dashboard model tolerates partial metadata (name without icon)", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-web-phaseb-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    await setAuthGuildsDetailed([{ id: "guild-1", name: "Guild One" }]);

    const { getDbForCampaign } = await import("../db.js");
    const { ensureGuildConfig, setGuildCampaignSlug } = await import("../campaign/guildConfig.js");
    const { createShowtimeCampaign } = await import("../campaign/showtimeCampaigns.js");
    const { startSession } = await import("../sessions/sessions.js");

    const db = getDbForCampaign("default");
    ensureGuildConfig("guild-1", "Guild One");
    const campaign = createShowtimeCampaign({ guildId: "guild-1", campaignName: "Alpha", createdByUserId: "dm-1" });
    setGuildCampaignSlug("guild-1", campaign.campaign_slug);
    startSession("guild-1", "dm-1", "DM One", { source: "live", kind: "canon", modeAtStart: "canon" });

    const model = await getWebDashboardModel();
    expect(model.authState).toBe("ok");
    expect(model.campaigns.length).toBeGreaterThan(0);
    expect(model.campaigns[0]?.guildName).toBe("Guild One");
    expect(model.campaigns[0]?.guildIconUrl ?? null).toBeNull();

    db.close();
  });

  test("dashboard model marks isDm=true for campaigns where current user is DM", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-web-phaseb-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    await setAuthGuildsDetailed([{ id: "guild-1", name: "Guild One" }], "dm-1");

    const { getDbForCampaign } = await import("../db.js");
    const { ensureGuildConfig, setGuildCampaignSlug, setGuildDmUserId } = await import("../campaign/guildConfig.js");
    const { createShowtimeCampaign } = await import("../campaign/showtimeCampaigns.js");
    const { startSession } = await import("../sessions/sessions.js");

    const db = getDbForCampaign("default");
    ensureGuildConfig("guild-1", "Guild One");
    setGuildDmUserId("guild-1", "dm-1");
    const campaign = createShowtimeCampaign({ guildId: "guild-1", campaignName: "Alpha", createdByUserId: "dm-1" });
    setGuildCampaignSlug("guild-1", campaign.campaign_slug);
    startSession("guild-1", "dm-1", "DM One", { source: "live", kind: "canon", modeAtStart: "canon" });

    const model = await getWebDashboardModel();
    expect(model.authState).toBe("ok");
    expect(model.campaigns.length).toBeGreaterThan(0);
    expect(model.campaigns[0]?.isDm).toBe(true);

    db.close();
  });

  test("dashboard model marks isDm=false for authorized non-DM users", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-web-phaseb-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    await setAuthGuildsDetailed([{ id: "guild-1", name: "Guild One" }], "player-1");

    const { getDbForCampaign } = await import("../db.js");
    const { ensureGuildConfig, setGuildCampaignSlug, setGuildDmUserId } = await import("../campaign/guildConfig.js");
    const { createShowtimeCampaign } = await import("../campaign/showtimeCampaigns.js");
    const { startSession } = await import("../sessions/sessions.js");

    const db = getDbForCampaign("default");
    ensureGuildConfig("guild-1", "Guild One");
    setGuildDmUserId("guild-1", "dm-1");
    const campaign = createShowtimeCampaign({ guildId: "guild-1", campaignName: "Alpha", createdByUserId: "dm-1" });
    setGuildCampaignSlug("guild-1", campaign.campaign_slug);
    startSession("guild-1", "dm-1", "DM One", { source: "live", kind: "canon", modeAtStart: "canon" });

    const model = await getWebDashboardModel();
    expect(model.authState).toBe("ok");
    expect(model.campaigns.length).toBeGreaterThan(0);
    expect(model.campaigns[0]?.isDm).toBe(false);

    db.close();
  });
});
