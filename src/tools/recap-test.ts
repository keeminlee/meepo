import "dotenv/config";
import {
  generateSessionRecap,
  getSessionRecap,
  regenerateSessionRecap,
  type SessionRecap,
} from "../sessions/sessionRecaps.js";

type CliArgs = {
  guildId: string;
  sessionId: string;
  force: boolean;
  regenerate: boolean;
  reason?: string;
};

function printUsage(): void {
  console.log("Usage:");
  console.log("  npm run recap:test -- --guild <guild_id> --session <session_id> [--force]");
  console.log("  npm run recap:test -- --guild <guild_id> --session <session_id> --regenerate [--reason <text>]");
}

function parseArgs(argv: string[]): CliArgs {
  let guildId = "";
  let sessionId = "";
  let force = false;
  let regenerate = false;
  let reason: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--guild") {
      guildId = String(argv[i + 1] ?? "").trim();
      i += 1;
      continue;
    }

    if (token === "--session") {
      sessionId = String(argv[i + 1] ?? "").trim();
      i += 1;
      continue;
    }

    if (token === "--force") {
      force = true;
      continue;
    }

    if (token === "--regenerate") {
      regenerate = true;
      continue;
    }

    if (token === "--reason") {
      const value = String(argv[i + 1] ?? "").trim();
      if (value.length > 0) {
        reason = value;
      }
      i += 1;
    }
  }

  if (!guildId || !sessionId) {
    printUsage();
    throw new Error("Missing required --guild and/or --session argument.");
  }

  return {
    guildId,
    sessionId,
    force,
    regenerate,
    reason,
  };
}

function printRecapContract(recap: SessionRecap): void {
  console.log("=== session_recaps contract ===");
  console.log(`guildId=${recap.guildId}`);
  console.log(`campaignSlug=${recap.campaignSlug}`);
  console.log(`sessionId=${recap.sessionId}`);
  console.log(`generatedAt=${recap.generatedAt}`);
  console.log(`modelVersion=${recap.modelVersion}`);
  console.log(`engine=${recap.engine ?? "(null)"}`);
  console.log(`sourceHash=${recap.sourceHash ?? "(null)"}`);
  console.log(`updatedAtMs=${recap.updatedAtMs}`);
  console.log("");

  console.log("--- concise ---");
  console.log(recap.views.concise);
  console.log("");

  console.log("--- balanced ---");
  console.log(recap.views.balanced);
  console.log("");

  console.log("--- detailed ---");
  console.log(recap.views.detailed);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.regenerate) {
    await regenerateSessionRecap({
      guildId: args.guildId,
      sessionId: args.sessionId,
      reason: args.reason,
    });
  } else {
    await generateSessionRecap({
      guildId: args.guildId,
      sessionId: args.sessionId,
      force: args.force,
    });
  }

  const stored = getSessionRecap(args.guildId, args.sessionId);
  if (!stored) {
    throw new Error(`No session_recaps row found after generation for session ${args.sessionId}.`);
  }

  printRecapContract(stored);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[recap:test] failed: ${message}`);
  process.exitCode = 1;
});
