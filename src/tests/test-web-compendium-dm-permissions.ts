// @ts-nocheck
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { resolveWebAuthContext } from "../../apps/web/lib/server/authContext";
import {
  applyWebRegistryPendingAction,
  createWebRegistryEntry,
  getWebRegistrySnapshot,
  updateWebRegistryEntry,
} from "../../apps/web/lib/server/registryService";
import { getWebCampaignDetail } from "../../apps/web/lib/server/campaignReaders";
import { getDemoCampaignSummary } from "../../apps/web/lib/server/demoCampaign";

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

async function setupCampaign(args: { guildId: string; dmUserId: string; campaignName: string }): Promise<string> {
  const { getDbForCampaign } = await import("../db.js");
  const {
    ensureGuildConfig,
    setGuildCampaignSlug,
    setGuildMetaCampaignSlug,
    setGuildDmUserId,
  } = await import("../campaign/guildConfig.js");
  const { createShowtimeCampaign } = await import("../campaign/showtimeCampaigns.js");

  const db = getDbForCampaign("default");
  const cfg = ensureGuildConfig(args.guildId, "Guild One");
  setGuildMetaCampaignSlug(args.guildId, cfg.campaign_slug);
  setGuildDmUserId(args.guildId, args.dmUserId);

  const campaign = createShowtimeCampaign({
    guildId: args.guildId,
    campaignName: args.campaignName,
    createdByUserId: args.dmUserId,
  });
  setGuildCampaignSlug(args.guildId, campaign.campaign_slug);
  db.close();

  return campaign.campaign_slug;
}

function makeUniqueCampaignName(base: string, tempDir: string): string {
  const suffix = path.basename(tempDir).replace(/[^a-z0-9-]/gi, "").toLowerCase();
  return `${base}-${suffix}`;
}

describe("compendium DM-only write enforcement", () => {
  test("campaign detail exposes read-only reason for non-owner and editable state for owner", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-web-compendium-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const guildId = "guild-1";
    const dmUserId = "dm-1";
    const playerUserId = "player-1";
    const campaignSlug = await setupCampaign({
      guildId,
      dmUserId,
      campaignName: makeUniqueCampaignName("Compendium Alpha", tempDir),
    });

    await setAuth({ userId: dmUserId, guilds: [{ id: guildId, name: "Guild One" }] });
    const ownerCampaign = await getWebCampaignDetail({ campaignSlug });
    expect(ownerCampaign?.canWrite).toBe(true);
    expect(ownerCampaign?.readOnlyReason).toBeUndefined();

    await setAuth({ userId: playerUserId, guilds: [{ id: guildId, name: "Guild One" }] });
    const nonOwnerCampaign = await getWebCampaignDetail({ campaignSlug });
    expect(nonOwnerCampaign?.canWrite).toBe(false);
    expect(nonOwnerCampaign?.readOnlyReason).toBe("not_campaign_dm");

    const demoCampaign = getDemoCampaignSummary();
    expect(demoCampaign.canWrite).toBe(false);
    expect(demoCampaign.readOnlyReason).toBe("demo_mode");
  });

  test("DM can create and update compendium entries", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-web-compendium-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const guildId = "guild-1";
    const dmUserId = "dm-1";
    const campaignSlug = await setupCampaign({
      guildId,
      dmUserId,
      campaignName: makeUniqueCampaignName("Compendium Alpha", tempDir),
    });

    await setAuth({ userId: dmUserId, guilds: [{ id: guildId, name: "Guild One" }] });

    const created = await createWebRegistryEntry({
      campaignSlug,
      body: {
        category: "npcs",
        canonicalName: "Captain Rowan",
        aliases: ["Rowan"],
        notes: "Harbor master",
      },
    });

    const createdNpc = created.categories.npcs.find((entry) => entry.canonicalName === "Captain Rowan");
    expect(createdNpc?.id).toBeTruthy();

    const updated = await updateWebRegistryEntry({
      campaignSlug,
      entryId: createdNpc!.id,
      body: {
        category: "npcs",
        canonicalName: "Captain Rowan",
        aliases: ["Rowan", "Captain"],
        notes: "Updated note",
      },
    });

    const updatedNpc = updated.categories.npcs.find((entry) => entry.id === createdNpc!.id);
    expect(updatedNpc?.aliases).toContain("Captain");
    expect(updatedNpc?.notes).toBe("Updated note");
  });

  test("non-DM cannot create or update compendium entries", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-web-compendium-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const guildId = "guild-1";
    const dmUserId = "dm-1";
    const playerUserId = "player-1";
    const campaignSlug = await setupCampaign({
      guildId,
      dmUserId,
      campaignName: makeUniqueCampaignName("Compendium Alpha", tempDir),
    });

    await setAuth({ userId: playerUserId, guilds: [{ id: guildId, name: "Guild One" }] });

    await expect(
      createWebRegistryEntry({
        campaignSlug,
        body: {
          category: "npcs",
          canonicalName: "Forbidden NPC",
          aliases: [],
          notes: "",
        },
      })
    ).rejects.toMatchObject({ code: "unauthorized", status: 403 });

    await setAuth({ userId: dmUserId, guilds: [{ id: guildId, name: "Guild One" }] });
    const createdByDm = await createWebRegistryEntry({
      campaignSlug,
      body: {
        category: "npcs",
        canonicalName: "Allowed NPC",
        aliases: [],
        notes: "",
      },
    });
    const target = createdByDm.categories.npcs.find((entry) => entry.canonicalName === "Allowed NPC");
    expect(target?.id).toBeTruthy();

    await setAuth({ userId: playerUserId, guilds: [{ id: guildId, name: "Guild One" }] });
    await expect(
      updateWebRegistryEntry({
        campaignSlug,
        entryId: target!.id,
        body: {
          category: "npcs",
          canonicalName: "Player Edit Attempt",
          aliases: [],
          notes: "",
        },
      })
    ).rejects.toMatchObject({ code: "unauthorized", status: 403 });
  });

  test("non-DM cannot apply pending compendium actions", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-web-compendium-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const guildId = "guild-1";
    const dmUserId = "dm-1";
    const playerUserId = "player-1";
    const campaignSlug = await setupCampaign({
      guildId,
      dmUserId,
      campaignName: makeUniqueCampaignName("Compendium Alpha", tempDir),
    });

    await setAuth({ userId: dmUserId, guilds: [{ id: guildId, name: "Guild One" }] });
    const snapshot = await getWebRegistrySnapshot({ campaignSlug });

    const repoRoot = path.resolve(process.cwd());
    const pendingPath = path.join(
      repoRoot,
      "data",
      "registry",
      `g_${guildId}__c_${campaignSlug}`,
      "decisions.pending.yml"
    );
    fs.mkdirSync(path.dirname(pendingPath), { recursive: true });
    fs.writeFileSync(
      pendingPath,
      [
        "version: 1",
        "generated_at: 2026-03-08T00:00:00.000Z",
        "source:",
        `  campaignSlug: ${campaignSlug}`,
        `  guildId: ${guildId}`,
        "pending:",
        "  - key: captain-rowan",
        "    display: Captain Rowan",
        "    count: 1",
        "    primaryCount: 1",
        "    examples:",
        "      - Captain Rowan keeps watch.",
        "",
      ].join("\n")
    );

    await setAuth({ userId: playerUserId, guilds: [{ id: guildId, name: "Guild One" }] });
    await expect(
      applyWebRegistryPendingAction({
        campaignSlug,
        body: {
          action: "accept",
          key: "captain-rowan",
          category: "npcs",
        },
      })
    ).rejects.toMatchObject({ code: "unauthorized", status: 403 });

    expect(snapshot.campaignSlug).toBe(campaignSlug);
  });
});
