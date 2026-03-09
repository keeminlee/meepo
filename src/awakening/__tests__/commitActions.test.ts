import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Scene } from "../../scripts/awakening/_schema.js";

const tempDirs: string[] = [];

function configureHermeticEnv(tempDir: string): void {
  vi.stubEnv("DATA_ROOT", tempDir);
  vi.stubEnv("DATA_CAMPAIGNS_DIR", "campaigns");
  vi.stubEnv("DATA_DB_FILENAME", "db.sqlite");
  vi.stubEnv("DISCORD_TOKEN", "test-token");
  vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
  vi.stubEnv("MIGRATIONS_SILENT", "1");
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
        // Ignore transient Windows file lock cleanup failures in test teardown.
      }
    }
  }
});

describe("awakening commit actions", () => {
  test("set_flag awakened is idempotent", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-commit-actions-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const { getDbForCampaign } = await import("../../db.js");
    const { initState, loadState } = await import("../../ledger/awakeningStateRepo.js");
    const { buildCommitContext, executeCommitAction } = await import("../commitActions/commitActionRegistry.js");
    const { getGuildAwakened } = await import("../../campaign/guildConfig.js");

    const db = getDbForCampaign("default");
    const state = initState("guild-1", "meepo_awaken", 1, "done", { db });

    const ctx = buildCommitContext({
      db,
      guildId: "guild-1",
      scriptId: "meepo_awaken",
      sceneId: "done",
      progress: state.progress_json,
      inputs: {},
      onboardingState: state,
    });

    await executeCommitAction(ctx, { type: "set_flag", key: "awakened", value: true });
    await executeCommitAction(ctx, { type: "set_flag", key: "awakened", value: true });

    expect(getGuildAwakened("guild-1")).toBe(true);
    expect(loadState("guild-1", "meepo_awaken", { db })?.completed).toBe(false);
    db.close();
  });

  test("set_guild_config can persist meta_campaign_slug", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-commit-actions-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const { getDbForCampaign } = await import("../../db.js");
    const { initState } = await import("../../ledger/awakeningStateRepo.js");
    const { buildCommitContext, executeCommitAction } = await import("../commitActions/commitActionRegistry.js");
    const { getGuildMetaCampaignSlug } = await import("../../campaign/guildConfig.js");

    const db = getDbForCampaign("default");
    const state = initState("guild-1", "meepo_awaken", 1, "done", { db });

    const ctx = buildCommitContext({
      db,
      guildId: "guild-1",
      scriptId: "meepo_awaken",
      sceneId: "done",
      progress: state.progress_json,
      inputs: {},
      onboardingState: state,
    });

    await executeCommitAction(ctx, {
      type: "set_guild_config",
      key: "meta_campaign_slug",
      value: "keemin_s_d_d_server",
    });

    expect(getGuildMetaCampaignSlug("guild-1")).toBe("keemin_s_d_d_server");
    db.close();
  });

  test("write_memory is idempotent for dm_display_name", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-commit-actions-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const { getDbForCampaign } = await import("../../db.js");
    const { initState } = await import("../../ledger/awakeningStateRepo.js");
    const { buildCommitContext, executeCommitAction } = await import("../commitActions/commitActionRegistry.js");

    const db = getDbForCampaign("default");
    const state = initState("guild-1", "meepo_awaken", 1, "ask_dm_name", { db });

    const ctx = buildCommitContext({
      db,
      guildId: "guild-1",
      scriptId: "meepo_awaken",
      sceneId: "ask_dm_name",
      progress: state.progress_json,
      inputs: { dm_display_name: "ZZZ_TEST_DM_NAME" },
      onboardingState: state,
    });

    await executeCommitAction(ctx, {
      type: "write_memory",
      memory_key: "dm_display_name",
      scope: "guild",
      from: "dm_display_name",
    });
    await executeCommitAction(ctx, {
      type: "write_memory",
      memory_key: "dm_display_name",
      scope: "guild",
      from: "dm_display_name",
    });

    const rows = db
      .prepare("SELECT key, text, source FROM meepo_mind_memory WHERE scope_kind = 'guild' AND scope_id = ?")
      .all("guild-1") as Array<{ key: string; text: string; source: string }>;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.key).toBe("dm_display_name");
    expect(rows[0]?.text).toContain("ZZZ_TEST_DM_NAME");
    db.close();
  });

  test("append_registry_yaml hard gate + append-only semantics", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-commit-actions-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const { getDbForCampaign } = await import("../../db.js");
    const { initState, markComplete } = await import("../../ledger/awakeningStateRepo.js");
    const { buildCommitContext, executeCommitAction } = await import("../commitActions/commitActionRegistry.js");
    const { setGuildAwakened, setGuildCampaignSlug } = await import("../../campaign/guildConfig.js");
    const { getRegistryDirForScope } = await import("../../registry/scaffold.js");
    const yaml = (await import("yaml")).default;

    const db = getDbForCampaign("default");
    setGuildCampaignSlug("guild-1", "default");

    const noStateCtx = buildCommitContext({
      db,
      guildId: "guild-1",
      scriptId: "meepo_awaken",
      sceneId: "registry",
      progress: {},
      inputs: { players: [{ discord_user_id: "u-1", canonical_name: "Sen" }] },
      onboardingState: ({
        guild_id: "guild-1",
        script_id: "meepo_awaken",
        script_version: 1,
        current_scene: "registry",
        beat_index: 0,
        progress_json: {},
        completed: true,
        created_at: Date.now(),
        updated_at: Date.now(),
      }),
    });

    await expect(executeCommitAction(noStateCtx, {
      type: "append_registry_yaml",
      target: "pcs",
      entries_from: "players",
      mode: "append_only",
    })).rejects.toThrow("registry writes are setup-only");

    const state = initState("guild-1", "meepo_awaken", 1, "registry", { db });
    const completeState = markComplete("guild-1", "meepo_awaken", { db });

    const completeCtx = buildCommitContext({
      db,
      guildId: "guild-1",
      scriptId: "meepo_awaken",
      sceneId: "registry",
      progress: completeState.progress_json,
      inputs: { players: [{ discord_user_id: "u-1", canonical_name: "Sen" }] },
      onboardingState: completeState,
    });

    await expect(executeCommitAction(completeCtx, {
      type: "append_registry_yaml",
      target: "pcs",
      entries_from: "players",
      mode: "append_only",
    })).rejects.toThrow("registry writes are setup-only");

    const activeState = initState("guild-1", "meepo_awaken", 1, "registry", { db });
    setGuildAwakened("guild-1", true);
    const awakenedCtx = buildCommitContext({
      db,
      guildId: "guild-1",
      scriptId: "meepo_awaken",
      sceneId: "registry",
      progress: activeState.progress_json,
      inputs: { players: [{ discord_user_id: "u-1", canonical_name: "Sen" }] },
      onboardingState: activeState,
    });

    await expect(executeCommitAction(awakenedCtx, {
      type: "append_registry_yaml",
      target: "pcs",
      entries_from: "players",
      mode: "append_only",
    })).rejects.toThrow("registry writes are setup-only");

    setGuildAwakened("guild-1", false);
    const writableState = initState("guild-2", "meepo_awaken", 1, "registry", { db });

    const writableCtx = buildCommitContext({
      db,
      guildId: "guild-2",
      scriptId: "meepo_awaken",
      sceneId: "registry",
      progress: writableState.progress_json,
      inputs: {
        players: [
          { discord_user_id: "u-1", canonical_name: "Sen" },
          { discord_user_id: "u-2", canonical_name: "Sen" },
        ],
      },
      onboardingState: writableState,
    });

    await executeCommitAction(writableCtx, {
      type: "append_registry_yaml",
      target: "pcs",
      entries_from: "players",
      mode: "append_only",
    });

    const registryDir = getRegistryDirForScope({ guildId: "guild-2", campaignSlug: "default" });
    const pcsPath = path.join(registryDir, "pcs.yml");
    expect(fs.existsSync(pcsPath)).toBe(true);

    const parsed = yaml.parse(fs.readFileSync(pcsPath, "utf8")) as { version: number; characters: Array<{ id: string; discord_user_id: string }> };
    expect(parsed.version).toBe(1);
    expect(parsed.characters).toHaveLength(2);
    expect(parsed.characters[0]?.id).toBe("pc_sen");
    expect(parsed.characters[1]?.id).toBe("pc_sen_2");

    await executeCommitAction(writableCtx, {
      type: "append_registry_yaml",
      target: "pcs",
      entries_from: "players",
      mode: "append_only",
    });

    const parsedAgain = yaml.parse(fs.readFileSync(pcsPath, "utf8")) as { characters: Array<{ id: string; discord_user_id: string }> };
    expect(parsedAgain.characters).toHaveLength(2);
    db.close();
  });
});
