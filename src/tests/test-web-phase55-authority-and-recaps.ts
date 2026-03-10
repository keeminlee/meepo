// @ts-nocheck
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { resolveWebAuthContext } from "../../apps/web/lib/server/authContext";
import { WebDataError } from "../../apps/web/lib/mappers/errorMappers";
import {
  getWebSessionDetail,
  regenerateWebSessionRecap,
  updateWebSessionLabel,
} from "../../apps/web/lib/server/sessionReaders";
import { updateWebCampaignName } from "../../apps/web/lib/server/campaignReaders";

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

async function setAuth(args: {
  userId: string;
  guilds: Array<{ id: string; name?: string; iconUrl?: string }>;
}): Promise<void> {
  const mocked = vi.mocked(resolveWebAuthContext);
  const guildIds = args.guilds.map((guild) => guild.id);
  mocked.mockResolvedValue({
    kind: "authenticated",
    source: "session_snapshot",
    user: { id: args.userId, name: "Tester", globalName: "Tester" },
    authorizedGuildIds: guildIds,
    authorizedGuilds: args.guilds,
    primaryGuildId: guildIds[0] ?? null,
    devBypass: false,
  } as any);
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

async function setupGuildCampaignAndSession(args: {
  guildId: string;
  dmUserId: string;
  playerUserId: string;
  campaignDmUserId?: string;
}): Promise<{ campaignSlug: string; sessionId: string }> {
  await setAuth({ userId: args.playerUserId, guilds: [{ id: args.guildId, name: "Guild One" }] });

  const { getDbForCampaign } = await import("../db.js");
  const {
    ensureGuildConfig,
    setGuildCampaignSlug,
    setGuildMetaCampaignSlug,
    setGuildDmUserId,
  } = await import("../campaign/guildConfig.js");
  const { createShowtimeCampaign } = await import("../campaign/showtimeCampaigns.js");
  const { startSession, endSession, getMostRecentSession } = await import("../sessions/sessions.js");

  const db = getDbForCampaign("default");
  const cfg = ensureGuildConfig(args.guildId, "Guild One");
  setGuildMetaCampaignSlug(args.guildId, cfg.campaign_slug);
  setGuildDmUserId(args.guildId, args.dmUserId);

  const campaign = createShowtimeCampaign({
    guildId: args.guildId,
    campaignName: "Campaign Alpha",
    createdByUserId: args.campaignDmUserId ?? args.dmUserId,
    dmUserId: args.campaignDmUserId ?? args.dmUserId,
  });
  setGuildCampaignSlug(args.guildId, campaign.campaign_slug);

  startSession(args.guildId, args.dmUserId, "DM", {
    source: "live",
    kind: "canon",
    modeAtStart: "canon",
  });
  endSession(args.guildId, "showtime_end");

  const session = getMostRecentSession(args.guildId);
  expect(session?.session_id).toBeTruthy();
  db.close();

  return {
    campaignSlug: campaign.campaign_slug,
    sessionId: session!.session_id,
  };
}

describe("Phase 5.5 write authority enforcement", () => {
  test("non-DM is denied campaign rename and DM is allowed", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-phase55-auth-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const guildId = "guild-1";
    const dmUserId = "dm-1";
    const playerUserId = "player-1";
    const { campaignSlug } = await setupGuildCampaignAndSession({ guildId, dmUserId, playerUserId });

    await setAuth({ userId: playerUserId, guilds: [{ id: guildId, name: "Guild One" }] });
    await expect(
      updateWebCampaignName({ campaignSlug, campaignName: "Player Rename" })
    ).rejects.toMatchObject({ code: "unauthorized", status: 403 });

    await setAuth({ userId: dmUserId, guilds: [{ id: guildId, name: "Guild One" }] });
    const renamed = await updateWebCampaignName({ campaignSlug, campaignName: "DM Rename" });
    expect(renamed.name).toBe("DM Rename");
  });

  test("guild DM is denied when campaign owner is a different user", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-phase55-auth-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const guildId = "guild-1";
    const guildDmUserId = "dm-1";
    const campaignOwnerUserId = "dm-2";
    const playerUserId = "player-1";
    const { campaignSlug } = await setupGuildCampaignAndSession({
      guildId,
      dmUserId: guildDmUserId,
      campaignDmUserId: campaignOwnerUserId,
      playerUserId,
    });

    await setAuth({ userId: guildDmUserId, guilds: [{ id: guildId, name: "Guild One" }] });
    await expect(
      updateWebCampaignName({ campaignSlug, campaignName: "Guild DM Rename Attempt" })
    ).rejects.toMatchObject({ code: "unauthorized", status: 403 });

    await setAuth({ userId: campaignOwnerUserId, guilds: [{ id: guildId, name: "Guild One" }] });
    const renamed = await updateWebCampaignName({ campaignSlug, campaignName: "Campaign Owner Rename" });
    expect(renamed.name).toBe("Campaign Owner Rename");
  });

  test("non-DM is denied session label edit and DM is allowed", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-phase55-auth-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const guildId = "guild-1";
    const dmUserId = "dm-1";
    const playerUserId = "player-1";
    const { sessionId } = await setupGuildCampaignAndSession({ guildId, dmUserId, playerUserId });

    await setAuth({ userId: playerUserId, guilds: [{ id: guildId, name: "Guild One" }] });
    await expect(updateWebSessionLabel({ sessionId, label: "Player Label" })).rejects.toMatchObject({
      code: "unauthorized",
      status: 403,
    });

    await setAuth({ userId: dmUserId, guilds: [{ id: guildId, name: "Guild One" }] });
    const updated = await updateWebSessionLabel({ sessionId, label: "DM Label" });
    expect(updated.label).toBe("DM Label");
  });

  test("guild DM cannot edit session labels when campaign owner differs", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-phase55-auth-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const guildId = "guild-1";
    const guildDmUserId = "dm-1";
    const campaignOwnerUserId = "dm-2";
    const playerUserId = "player-1";
    const { sessionId } = await setupGuildCampaignAndSession({
      guildId,
      dmUserId: guildDmUserId,
      campaignDmUserId: campaignOwnerUserId,
      playerUserId,
    });

    await setAuth({ userId: guildDmUserId, guilds: [{ id: guildId, name: "Guild One" }] });
    await expect(updateWebSessionLabel({ sessionId, label: "Guild DM Label Attempt" })).rejects.toMatchObject({
      code: "unauthorized",
      status: 403,
    });

    await setAuth({ userId: campaignOwnerUserId, guilds: [{ id: guildId, name: "Guild One" }] });
    const updated = await updateWebSessionLabel({ sessionId, label: "Campaign Owner Label" });
    expect(updated.label).toBe("Campaign Owner Label");
  });

  test("non-DM is denied recap regenerate before capability checks; DM reaches capability gate", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-phase55-auth-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const guildId = "guild-1";
    const dmUserId = "dm-1";
    const playerUserId = "player-1";
    const { sessionId } = await setupGuildCampaignAndSession({ guildId, dmUserId, playerUserId });

    await setAuth({ userId: playerUserId, guilds: [{ id: guildId, name: "Guild One" }] });
    await expect(regenerateWebSessionRecap({ sessionId, reason: "test" })).rejects.toMatchObject({
      code: "unauthorized",
      status: 403,
    });

    // Flip capability env only after runtime DB/bootstrap imports are complete.
    vi.stubEnv("OPENAI_API_KEY", "");

    await setAuth({ userId: dmUserId, guilds: [{ id: guildId, name: "Guild One" }] });
    await expect(regenerateWebSessionRecap({ sessionId, reason: "test" })).rejects.toMatchObject({
      code: "openai_unconfigured",
      status: 503,
    });
  });
});

describe("Phase 5.5 recap source visibility", () => {
  test("session detail exposes canonical recap source", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-phase55-recap-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const guildId = "guild-1";
    const dmUserId = "dm-1";
    const playerUserId = "player-1";
    const { campaignSlug, sessionId } = await setupGuildCampaignAndSession({ guildId, dmUserId, playerUserId });

    const { upsertSessionRecap } = await import("../sessions/sessionRecaps.js");
    upsertSessionRecap({
      guildId,
      campaignSlug,
      sessionId,
      views: {
        concise: "Canonical concise",
        balanced: "Canonical balanced",
        detailed: "Canonical detailed",
      },
      strategyVersion: "session-recaps-v2",
      engine: "test-engine",
    });

    await setAuth({ userId: playerUserId, guilds: [{ id: guildId, name: "Guild One" }] });
    const detail = await getWebSessionDetail({ sessionId });
    expect(detail.recap?.source).toBe("canonical");
    expect(detail.recap?.balanced).toContain("Canonical balanced");
  });

  test("session detail exposes legacy artifact recap source when canonical row is absent", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-phase55-recap-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const guildId = "guild-1";
    const dmUserId = "dm-1";
    const playerUserId = "player-1";
    const { campaignSlug, sessionId } = await setupGuildCampaignAndSession({ guildId, dmUserId, playerUserId });

    const { getDbForCampaign } = await import("../db.js");
    const campaignDb = getDbForCampaign(campaignSlug);
    campaignDb.prepare("DELETE FROM session_recaps WHERE session_id = ?").run(sessionId);
    campaignDb
      .prepare(
        `INSERT INTO session_artifacts (session_id, artifact_type, content_text, created_at_ms, engine, source_hash, strategy_version, meta_json)
         VALUES (?, 'recap_final', ?, ?, ?, NULL, ?, NULL)`
      )
      .run(sessionId, "Legacy artifact recap", Date.now(), "legacy-engine", "legacy-v1");
    campaignDb.close();

    await setAuth({ userId: playerUserId, guilds: [{ id: guildId, name: "Guild One" }] });
    const detail = await getWebSessionDetail({ sessionId });
    expect(detail.recap?.source).toBe("legacy_artifact");
    expect(detail.recap?.concise).toContain("Legacy artifact recap");
  });

  test("session detail exposes legacy meecap source when canonical + artifact rows are absent", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-phase55-recap-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const guildId = "guild-1";
    const dmUserId = "dm-1";
    const playerUserId = "player-1";
    const { campaignSlug, sessionId } = await setupGuildCampaignAndSession({ guildId, dmUserId, playerUserId });

    const { getDbForCampaign } = await import("../db.js");
    const campaignDb = getDbForCampaign(campaignSlug);
    campaignDb.prepare("DELETE FROM session_recaps WHERE session_id = ?").run(sessionId);
    campaignDb.prepare("DELETE FROM session_artifacts WHERE session_id = ? AND artifact_type = 'recap_final'").run(sessionId);
    campaignDb
      .prepare(
        `INSERT INTO meecaps (session_id, meecap_narrative, model, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(sessionId, "Legacy meecap narrative", "legacy-meecap-model", Date.now() - 1000, Date.now());
    campaignDb.close();

    await setAuth({ userId: playerUserId, guilds: [{ id: guildId, name: "Guild One" }] });
    const detail = await getWebSessionDetail({ sessionId });
    expect(detail.recap?.source).toBe("legacy_meecap");
    expect(detail.recap?.balanced).toContain("Legacy meecap narrative");
  });
});