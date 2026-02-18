import "dotenv/config";
import { getDb } from "../db.js";
import { compileAndExportSession } from "./compile-and-export-events.js";
import { getOfficialSessionLabels } from "../sessions/officialSessions.js";

function parseArgs(): { force: boolean } {
  const args = process.argv.slice(2);
  let force = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--force") {
      force = true;
    }
  }

  return { force };
}

async function main(): Promise<void> {
  const { force } = parseArgs();
  const db = getDb();

  const labels = getOfficialSessionLabels(db);

  if (labels.length === 0) {
    console.log("No labeled sessions found (excluding labels containing 'test').");
    return;
  }

  console.log(`Found ${labels.length} session label(s) to compile.`);
  for (const label of labels) {
    console.log(`- ${label}`);
  }

  let successCount = 0;
  let failureCount = 0;

  for (const label of labels) {
    try {
      await compileAndExportSession(label, force);
      successCount++;
    } catch (err) {
      console.error(`Failed to compile session label: ${label}`);
      failureCount++;
    }
  }

  console.log(`Batch compile complete. Success: ${successCount}, Failed: ${failureCount}`);

  if (failureCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Batch compile failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
