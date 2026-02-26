import "dotenv/config";
import path from "node:path";
import { readCsvRows } from "../../gold/csvIO.js";
import {
  normalizeGoldMemoryCsvRecord,
  GOLD_MEMORY_COLUMNS,
  type GoldMemoryCsvRow,
} from "../../gold/csvSchema.js";
import { upsertGoldMemories } from "../../gold/goldMemoryRepo.js";
import { resolveCampaignSlug } from "../../campaign/guildConfig.js";
import { getEnv } from "../../config/rawEnv.js";

function parseArgs(): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = process.argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function isBlankCsvRow(row: Record<string, string>): boolean {
  return Object.values(row).every((value) => value.trim().length === 0);
}

function main(): void {
  const args = parseArgs();
  const strict = Boolean(args.strict);
  const dryRun = Boolean(args["dry-run"]);
  const guildId = String(args.guild ?? getEnv("GUILD_ID", "") ?? "").trim();
  if (!guildId) throw new Error("Missing --guild <guild_id> (or GUILD_ID env)");
  const campaignSlug = String(args.campaign ?? resolveCampaignSlug({ guildId })).trim();
  const csvPath = String(args.csv ?? path.join("data", campaignSlug, "gold_memories.csv"));

  const raw = readCsvRows(csvPath);
  const filteredRaw = raw.filter((row) => !isBlankCsvRow(row));
  if (filteredRaw.length === 0) {
    console.log(`No rows found in ${csvPath}`);
    return;
  }

  const rows: GoldMemoryCsvRow[] = filteredRaw.map((r) =>
    normalizeGoldMemoryCsvRecord(r, {
      strict,
      defaultGuildId: guildId,
      defaultCampaignSlug: campaignSlug,
    }),
  );

  const missingCols = [...GOLD_MEMORY_COLUMNS].filter((c) => !(c in filteredRaw[0]));
  if (strict && missingCols.length > 0) {
    throw new Error(`Strict mode: missing columns in CSV header: ${missingCols.join(", ")}`);
  }

  if (dryRun) {
    console.log(`DRY RUN: parsed ${rows.length} rows from ${csvPath}`);
    return;
  }

  const summary = upsertGoldMemories(rows);
  console.log(
    `Upserted gold memories from ${csvPath}: inserted=${summary.inserted} updated=${summary.updated} unchanged=${summary.unchanged}`,
  );
}

main();
