// @ts-nocheck
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { getWebSessionDetail } from "../../apps/web/lib/server/sessionReaders";
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
  const mocked = vi.mocked(resolveWebAuthContext);
  const guilds = guildIds.map((id) => ({ id, name: `Guild ${id}` }));
  const context: MockAuthContext = {
    kind: "authenticated",
    source: "session_snapshot",
    user: { id: "user-1", name: "Tester", globalName: "Tester" },
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

describe("web recap visibility reflection", () => {
  test("shows recap available for a completed session after successful canonical recap write", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-web-recap-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    await setAuthGuilds(["guild-1"]);

    const { getDbForCampaign } = await import("../db.js");
    const { ensureGuildConfig, setGuildAwakened, setGuildMetaCampaignSlug, setGuildCampaignSlug } = await import("../campaign/guildConfig.js");
    const { createShowtimeCampaign } = await import("../campaign/showtimeCampaigns.js");
    const { startSession, endSession, getMostRecentSession } = await import("../sessions/sessions.js");
    const { upsertSessionRecap } = await import("../sessions/sessionRecaps.js");

    const db = getDbForCampaign("default");

    const cfg = ensureGuildConfig("guild-1", "Guild One");
    setGuildAwakened("guild-1", true);
    setGuildMetaCampaignSlug("guild-1", cfg.campaign_slug);

    const alpha = createShowtimeCampaign({ guildId: "guild-1", campaignName: "Campaign Alpha", createdByUserId: "dm" });
    setGuildCampaignSlug("guild-1", alpha.campaign_slug);

    startSession("guild-1", "dm", "DM", { source: "live", kind: "canon", modeAtStart: "canon" });
    endSession("guild-1", "showtime_end");

    const session = getMostRecentSession("guild-1");
    expect(session?.session_id).toBeTruthy();

    const beta = createShowtimeCampaign({ guildId: "guild-1", campaignName: "Campaign Beta", createdByUserId: "dm" });
    setGuildCampaignSlug("guild-1", beta.campaign_slug);

    upsertSessionRecap({
      guildId: "guild-1",
      campaignSlug: alpha.campaign_slug,
      sessionId: session!.session_id,
      views: {
        concise: "Concise recap.",
        balanced: "Balanced recap.",
        detailed: "Detailed recap.",
      },
      strategyVersion: "session-recaps-v2",
      engine: "test-engine",
    });

    const detail = await getWebSessionDetail({ sessionId: session!.session_id });
    expect(detail.id).toBe(session!.session_id);
    expect(detail.campaignSlug).toBe(alpha.campaign_slug);
    expect(detail.artifacts.recap).toBe("available");
    expect(detail.recap?.balanced).toContain("Balanced recap");

    db.close();
  });
});
