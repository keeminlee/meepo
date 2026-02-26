import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { readCsvRows } from "../../gold/csvIO.js";
import {
  normalizeGoldCandidateCsvRecord,
  GOLD_CANDIDATE_COLUMNS,
  type GoldCandidateCsvRow,
} from "../../gold/csvSchema.js";
import { upsertGoldCandidates } from "../../gold/goldMemoryRepo.js";
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

function main(): void {
  const args = parseArgs();
  const strict = Boolean(args.strict);
  const dryRun = Boolean(args["dry-run"]);
  const moveProcessed = Boolean(args.move);
  const deleteProcessed = Boolean(args.delete);
  const guildId = String(args.guild ?? getEnv("GUILD_ID", "") ?? "").trim();
  if (!guildId) throw new Error("Missing --guild <guild_id> (or GUILD_ID env)");
  const campaignSlug = String(args.campaign ?? resolveCampaignSlug({ guildId })).trim();
  const sessionId = (args.session as string | undefined) ?? null;
  const csvPath = String(args.csv ?? path.join("data", campaignSlug, "candidates", "sample_candidates.csv"));

  const raw = readCsvRows(csvPath);
  if (raw.length === 0) {
    console.log(`No candidate rows found in ${csvPath}`);
    return;
  }

  const missingCols = [...GOLD_CANDIDATE_COLUMNS].filter((c) => !(c in raw[0]));
  if (strict && missingCols.length > 0) {
    throw new Error(`Strict mode: missing columns in CSV header: ${missingCols.join(", ")}`);
  }

  const rows: GoldCandidateCsvRow[] = raw.map((r) =>
    normalizeGoldCandidateCsvRecord(r, {
      strict,
      defaultGuildId: guildId,
      defaultCampaignSlug: campaignSlug,
      defaultSessionId: sessionId,
    }),
  );

  if (dryRun) {
    console.log(`DRY RUN: parsed ${rows.length} candidate rows from ${csvPath}`);
    return;
  }

  const summary = upsertGoldCandidates(rows, sessionId);
  const receipt = {
    at_ms: Date.now(),
    file: csvPath,
    guild_id: guildId,
    campaign_slug: campaignSlug,
    session_id: sessionId,
    summary,
  };

  const receiptsDir = path.join("data", campaignSlug, "candidates", "receipts");
  fs.mkdirSync(receiptsDir, { recursive: true });
  const receiptPath = path.join(receiptsDir, `receipt_${Date.now()}.json`);
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), "utf8");

  if (moveProcessed) {
    const processedDir = path.join("data", campaignSlug, "candidates", "processed");
    fs.mkdirSync(processedDir, { recursive: true });
    const target = path.join(processedDir, path.basename(csvPath));
    fs.renameSync(csvPath, target);
    console.log(`Moved candidate file -> ${target}`);
  } else if (deleteProcessed) {
    fs.unlinkSync(csvPath);
    console.log(`Deleted candidate file -> ${csvPath}`);
  }

  console.log(
    `Candidate import complete: inserted=${summary.inserted} updated=${summary.updated} unchanged=${summary.unchanged} receipt=${receiptPath}`,
  );
}

main();
