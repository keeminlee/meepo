/**
 * Batch Media Ingestion Tool
 *
 * Ingests all media files in a directory, assigning sequential session labels.
 *
 * Usage:
 *   tsx tools/batch-ingest-media.ts --mediaDir <path> [--outDb <path>] [--chunkSec <n>] [--maxMinutes <n>] [--startIndex <n>] [--guildId <id>]
 *
 * Options:
 *   --mediaDir <path>     Directory containing media files (mp4/mkv/mp3/wav)
 *   --outDb <path>        Output SQLite database path (default: ./data/bot.sqlite)
 *   --chunkSec <n>        Chunk length in seconds (default: 60)
 *   --maxMinutes <n>      Only ingest first N minutes per file (default: all)
 *   --startIndex <n>      Starting episode number (default: 1)
 *   --guildId <id>        Guild ID for ledger entries (default: offline_test)
 *   --dryRun              Show what would be ingested, don't actually run
 *   --help                Show this help
 *
 * Example:
 *   tsx tools/batch-ingest-media.ts --mediaDir "D:\Recordings\Campaign2" --outDb "./data/bot.sqlite" --startIndex 1
 *
 * This will ingest files as C2E1, C2E2, C2E3, etc. in order.
 */

import { execSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";

const SUPPORTED_EXTS = [".mp4", ".mkv", ".mp3", ".wav", ".m4a", ".webm"];

interface CliArgs {
  mediaDir: string;
  outDb: string;
  chunkSec: number;
  maxMinutes?: number;
  startIndex: number;
  guildId: string;
  dryRun: boolean;
  help: boolean;
}

function parseArgs(): CliArgs {
  const args: Partial<CliArgs> = {
    outDb: "./data/bot.sqlite",
    chunkSec: 60,
    startIndex: 1,
    guildId: "offline_test",
    dryRun: false,
    help: false,
  };

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];

    if (arg === "--help") {
      args.help = true;
    } else if (arg === "--dryRun") {
      args.dryRun = true;
    } else if (arg === "--mediaDir" && process.argv[i + 1]) {
      args.mediaDir = process.argv[i + 1];
      i++;
    } else if (arg === "--outDb" && process.argv[i + 1]) {
      args.outDb = process.argv[i + 1];
      i++;
    } else if (arg === "--chunkSec" && process.argv[i + 1]) {
      args.chunkSec = parseInt(process.argv[i + 1], 10);
      i++;
    } else if (arg === "--maxMinutes" && process.argv[i + 1]) {
      args.maxMinutes = parseInt(process.argv[i + 1], 10);
      i++;
    } else if (arg === "--startIndex" && process.argv[i + 1]) {
      args.startIndex = parseInt(process.argv[i + 1], 10);
      i++;
    } else if (arg === "--guildId" && process.argv[i + 1]) {
      args.guildId = process.argv[i + 1];
      i++;
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  return args as CliArgs;
}

function printHelp(): void {
  console.log(`
Batch Media Ingestion Tool

Usage:
  tsx tools/batch-ingest-media.ts --mediaDir <path> [--outDb <path>] [options]

Options:
  --mediaDir <path>     Directory containing media files (mp4/mkv/mp3/wav)
  --outDb <path>        Output SQLite database path (default: ./data/bot.sqlite)
  --chunkSec <n>        Chunk length in seconds (default: 60)
  --maxMinutes <n>      Only ingest first N minutes per file (default: all)
  --startIndex <n>      Starting episode number (default: 1)
  --guildId <id>        Guild ID for ledger entries (default: offline_test)
  --dryRun              Show what would be ingested, don't actually run
  --help                Show this help

Example:
  tsx tools/batch-ingest-media.ts \\
    --mediaDir "D:\\Recordings\\Campaign2" \\
    --outDb "./data/bot.sqlite" \\
    --startIndex 1
`);
}

function getMediaFiles(mediaDir: string): string[] {
  if (!existsSync(mediaDir)) {
    throw new Error(`Media directory not found: ${mediaDir}`);
  }

  const files = readdirSync(mediaDir, { withFileTypes: true })
    .filter((f) => f.isFile())
    .filter((f) => SUPPORTED_EXTS.includes(extname(f.name).toLowerCase()))
    .map((f) => join(mediaDir, f.name))
    .sort(); // Sort alphabetically for consistent ordering

  if (files.length === 0) {
    throw new Error(`No media files found in ${mediaDir}`);
  }

  return files;
}

async function main(): Promise<void> {
  const cliArgs = parseArgs();

  if (cliArgs.help || !cliArgs.mediaDir) {
    printHelp();
    process.exit(cliArgs.help ? 0 : 1);
  }

  const mediaFiles = getMediaFiles(cliArgs.mediaDir);
  console.log(`\n📁 Found ${mediaFiles.length} media file(s) to ingest:\n`);

  mediaFiles.forEach((file, idx) => {
    console.log(`  ${idx + 1}. ${file}`);
  });

  console.log(`\n🎬 Campaign: C2E{${cliArgs.startIndex}..${cliArgs.startIndex + mediaFiles.length - 1}}`);
  console.log(`📊 Output DB: ${cliArgs.outDb}\n`);

  if (cliArgs.dryRun) {
    console.log("🏁 DRY RUN - no ingestion will occur. Remove --dryRun to proceed.\n");
    return;
  }

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < mediaFiles.length; i++) {
    const mediaFile = mediaFiles[i];
    const episodeIndex = cliArgs.startIndex + i;
    const sessionLabel = `C2E${episodeIndex}`;

    console.log(`\n[${"=".repeat(60)}]`);
    console.log(`[${i + 1}/${mediaFiles.length}] Ingesting: ${sessionLabel}`);
    console.log(`[File: ${mediaFile}]`);
    console.log(`[${"=".repeat(60)}]\n`);

    try {
      const cmd = [
        "npx tsx tools/ingest-media.ts",
        `--mediaPath "${mediaFile}"`,
        `--outDb "${cliArgs.outDb}"`,
        `--sessionLabel "${sessionLabel}"`,
        `--chunkSec ${cliArgs.chunkSec}`,
        `--guildId "${cliArgs.guildId}"`,
        ...(cliArgs.maxMinutes ? [`--maxMinutes ${cliArgs.maxMinutes}`] : []),
      ].join(" ");

      execSync(cmd, { stdio: "inherit" });
      successCount++;
      console.log(`\n✅ Successfully ingested ${sessionLabel}\n`);
    } catch (err: any) {
      errorCount++;
      console.error(`\n❌ Failed to ingest ${sessionLabel}`);
      console.error(`   Error: ${err.message}\n`);
    }
  }

  console.log(`\n[${"=".repeat(60)}]`);
  console.log(`[BATCH INGEST COMPLETE]`);
  console.log(`[${"=".repeat(60)}]`);
  console.log(`\n✅ Successful: ${successCount}/${mediaFiles.length}`);
  if (errorCount > 0) {
    console.log(`❌ Failed: ${errorCount}/${mediaFiles.length}`);
    process.exit(1);
  }
  console.log();
}

main().catch((err) => {
  console.error(`[batch-ingest-media] ERROR: ${err.message}`);
  process.exit(1);
});
