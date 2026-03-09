import fs from "node:fs";
import path from "node:path";
import { getControlDb } from "../db.js";
import { buildCampaignScopeDirName, getDataRoot } from "../dataPaths.js";

type ScopeRow = {
  guild_id: string;
  campaign_slug: string;
};

type CliArgs = {
  dryRun: boolean;
};

function parseArgs(): CliArgs {
  const dryRun = process.argv.includes("--dry-run");
  return { dryRun };
}

function ensureDir(dirPath: string, dryRun: boolean): void {
  if (dryRun) return;
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyDirectoryContents(args: {
  sourceDir: string;
  targetDir: string;
  dryRun: boolean;
}): { filesCopied: number; filesSkipped: number } {
  const { sourceDir, targetDir, dryRun } = args;
  if (!fs.existsSync(sourceDir)) {
    return { filesCopied: 0, filesSkipped: 0 };
  }

  ensureDir(targetDir, dryRun);

  let filesCopied = 0;
  let filesSkipped = 0;

  const queue: Array<{ src: string; dst: string }> = [{ src: sourceDir, dst: targetDir }];
  while (queue.length > 0) {
    const next = queue.pop();
    if (!next) break;

    for (const entry of fs.readdirSync(next.src, { withFileTypes: true })) {
      const srcPath = path.join(next.src, entry.name);
      const dstPath = path.join(next.dst, entry.name);

      if (entry.isDirectory()) {
        ensureDir(dstPath, dryRun);
        queue.push({ src: srcPath, dst: dstPath });
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (fs.existsSync(dstPath)) {
        filesSkipped += 1;
        continue;
      }

      if (!dryRun) {
        ensureDir(path.dirname(dstPath), false);
        fs.copyFileSync(srcPath, dstPath);
      }
      filesCopied += 1;
    }
  }

  return { filesCopied, filesSkipped };
}

function readScopes(): ScopeRow[] {
  const db = getControlDb();
  const rows = db
    .prepare(
      `
      SELECT DISTINCT guild_id, campaign_slug
      FROM (
        SELECT guild_id, campaign_slug FROM guild_config
        UNION ALL
        SELECT guild_id, campaign_slug FROM guild_campaigns
      )
      WHERE guild_id IS NOT NULL
        AND TRIM(guild_id) <> ''
        AND campaign_slug IS NOT NULL
        AND TRIM(campaign_slug) <> ''
      ORDER BY guild_id, campaign_slug
      `
    )
    .all() as ScopeRow[];

  return rows.map((row) => ({
    guild_id: row.guild_id.trim(),
    campaign_slug: row.campaign_slug.trim(),
  }));
}

function main(): void {
  const args = parseArgs();
  const dataRoot = getDataRoot();
  const legacyCampaignsRoot = path.join(dataRoot, "campaigns");
  const legacyRegistryRoot = path.join(dataRoot, "registry");

  const scopes = readScopes();
  const scopesBySlug = new Map<string, ScopeRow[]>();
  for (const scope of scopes) {
    const list = scopesBySlug.get(scope.campaign_slug) ?? [];
    list.push(scope);
    scopesBySlug.set(scope.campaign_slug, list);
  }

  console.log(`[scope-migrate] mode=${args.dryRun ? "dry-run" : "apply"}`);
  console.log(`[scope-migrate] scopes=${scopes.length}`);

  let totalCopied = 0;
  let totalSkipped = 0;

  for (const scope of scopes) {
    const scopedDir = buildCampaignScopeDirName({
      guildId: scope.guild_id,
      campaignSlug: scope.campaign_slug,
    });

    const legacyCampaignDir = path.join(legacyCampaignsRoot, scope.campaign_slug);
    const targetCampaignDir = path.join(legacyCampaignsRoot, scopedDir);

    const legacyRegistryDir = path.join(legacyRegistryRoot, scope.campaign_slug);
    const targetRegistryDir = path.join(legacyRegistryRoot, scopedDir);

    const siblings = scopesBySlug.get(scope.campaign_slug) ?? [];
    if (siblings.length > 1) {
      console.warn(
        `[scope-migrate] slug collision: '${scope.campaign_slug}' belongs to ${siblings.length} guild scopes; cloning legacy data into each scoped target.`
      );
    }

    const campaignResult = copyDirectoryContents({
      sourceDir: legacyCampaignDir,
      targetDir: targetCampaignDir,
      dryRun: args.dryRun,
    });

    const registryResult = copyDirectoryContents({
      sourceDir: legacyRegistryDir,
      targetDir: targetRegistryDir,
      dryRun: args.dryRun,
    });

    totalCopied += campaignResult.filesCopied + registryResult.filesCopied;
    totalSkipped += campaignResult.filesSkipped + registryResult.filesSkipped;

    console.log(
      `[scope-migrate] ${scope.guild_id} :: ${scope.campaign_slug} | campaigns +${campaignResult.filesCopied}/~${campaignResult.filesSkipped} registry +${registryResult.filesCopied}/~${registryResult.filesSkipped}`
    );
  }

  console.log(`[scope-migrate] files_copied=${totalCopied}`);
  console.log(`[scope-migrate] files_skipped_existing=${totalSkipped}`);
}

main();
