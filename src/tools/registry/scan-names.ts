import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import yaml from "yaml";
import { loadRegistry, normKey } from "../../registry/loadRegistry.js";
import { getRegistryDirForCampaign } from "../../registry/scaffold.js";
import { resolveCampaignSlug } from "../../campaign/guildConfig.js";
import { getDefaultCampaignSlug } from "../../campaign/defaultCampaign.js";
import { getEnv } from "../../config/rawEnv.js";
import { resolveCampaignDbPath } from "../../dataPaths.js";
import { pickTranscriptRows, scanNamesCore, type PendingCandidate } from "../../registry/scanNamesCore.js";

/**
 * Phase 1B: Name Scanner (campaign-scoped)
 *
 * Scans SQLite ledger for proper-name candidates, filters against registry,
 * and outputs decisions.pending.yml in the campaign's registry folder.
 *
 * Usage:
 *   npx tsx src/tools/registry/scan-names.ts --campaign faeterra-main
 *   npx tsx src/tools/registry/scan-names.ts --campaign auto --guild 123456789012345678
 *   npx tsx src/tools/registry/scan-names.ts  # uses DEFAULT_CAMPAIGN_SLUG or "default"
 */

type PendingDecisions = {
  version: number;
  generated_at: string;
  source: {
    db: string;
    guildId: string | null;
    campaignSlug: string;
    primaryOnly: boolean;
    minCount: number;
    sessionCount: number;
    transcriptSource: "ledger_entries" | "bronze_transcript";
  };
  pending: PendingCandidate[];
};

/**
 * Parse command-line arguments (dependency-free).
 */
function parseArgs(): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = process.argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

/**
 * Main scanner.
 */
function resolveCampaignFromArgs(args: Record<string, string | boolean>): string {
  const campaignOpt = (args.campaign as string) ?? "auto";
  const guildId = args.guild as string | undefined;
  if (campaignOpt !== "auto" && campaignOpt && String(campaignOpt).trim() !== "") {
    return String(campaignOpt).trim();
  }
  if (guildId) {
    return resolveCampaignSlug({ guildId });
  }
  return getDefaultCampaignSlug();
}

function scanNames(): void {
  const args = parseArgs();

  const guildId = (args.guild as string | undefined)?.trim() || null;
  const campaignSlug = resolveCampaignFromArgs(args);
  console.log(`Campaign: ${campaignSlug}`);

  if (guildId) {
    console.log(`Guild scope override: ${guildId}`);
  } else {
    console.log("Guild scope: campaign-wide");
  }

  const registryDir = getRegistryDirForCampaign(campaignSlug);
  const dbPath =
    (args.db as string) ||
    resolveCampaignDbPath(campaignSlug) ||
    getEnv("DATA_DB_PATH") ||
    getEnv("DB_PATH") ||
    "./data/bot.sqlite";
  const minCount = parseInt((args.minCount as string) || "3", 10);
  const primaryOnly = args.primaryOnly === true || args.primaryOnly === "true";
  const maxExamples = parseInt((args.maxExamples as string) || "3", 10);
  const pendingPath = (args.pendingOut as string) || path.join(registryDir, "decisions.pending.yml");
  const includeKnown = args.includeKnown === true || args.includeKnown === "true";

  console.log(`[scan-names] Loading registry...`);
  const registry = loadRegistry({ campaignSlug });

  console.log(`[scan-names] Connecting to ${dbPath}...`);
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}`);
  }

  const db = new Database(dbPath, { readonly: true });

  const sessionWhereParts = [
    "s.label IS NOT NULL",
    "TRIM(s.label) <> ''",
    "LOWER(TRIM(s.label)) NOT LIKE '%test%'",
    "LOWER(TRIM(s.label)) NOT LIKE '%chat%'",
  ];
  const sessionParams: unknown[] = [];
  if (guildId) {
    sessionWhereParts.push("s.guild_id = ?");
    sessionParams.push(guildId);
  }

  const sessionWhere = sessionWhereParts.join(" AND ");
  const sessionRows = db
    .prepare(
      `SELECT s.session_id, s.label
       FROM sessions s
       WHERE ${sessionWhere}`,
    )
    .all(...sessionParams) as Array<{ session_id: string; label: string | null }>;

  if (sessionRows.length === 0) {
    console.log("[scan-names] No labeled non-test/non-chat sessions found for this scope.");
  } else {
    console.log(`[scan-names] Session scope size: ${sessionRows.length}`);
  }

  const ledgerWhereParts = [
    "le.content IS NOT NULL",
    "TRIM(le.content) <> ''",
    ...sessionWhereParts,
  ];
  const ledgerParams: unknown[] = [...sessionParams];
  if (primaryOnly) {
    ledgerWhereParts.push("le.narrative_weight IN ('primary', 'elevated')");
  }

  console.log("[scan-names] Executing session-scoped ledger query...");
  const ledgerRows = db.prepare(
    `SELECT le.content, le.source, le.narrative_weight
     FROM ledger_entries le
     JOIN sessions s ON s.session_id = le.session_id
     WHERE ${ledgerWhereParts.join(" AND ")}`,
  ).all(...ledgerParams) as Array<{
    content: string;
    source: string;
    narrative_weight: string;
  }>;

  let bronzeRows: Array<{ content: string; source: string; narrative_weight: string }> = [];
  if (ledgerRows.length === 0) {
    console.log("[scan-names] No qualifying ledger rows found; falling back to bronze_transcript...");
    bronzeRows = db.prepare(
      `SELECT bt.content, bt.source_type as source, 'primary' as narrative_weight
       FROM bronze_transcript bt
       JOIN sessions s ON s.session_id = bt.session_id
       WHERE bt.content IS NOT NULL
         AND TRIM(bt.content) <> ''
         AND ${sessionWhere}`,
    ).all(...sessionParams) as Array<{
      content: string;
      source: string;
      narrative_weight: string;
    }>;
  }

  const transcriptSelection = pickTranscriptRows(ledgerRows, bronzeRows);
  const rows = transcriptSelection.rows;
  const transcriptSource = transcriptSelection.source;

  console.log(`[scan-names] Scanned ${rows.length} rows from ${transcriptSource}, extracting candidates...`);

  const scanResult = scanNamesCore({
    rows,
    registry,
    minCount,
    maxExamples,
    includeKnown,
  });

  db.close();

  const filtered = scanResult.pending;

  console.log(`[scan-names] Found ${filtered.length} candidates (minCount=${minCount})`);
  const knownHitsList = scanResult.knownHits;

  // Console output (unchanged)
  console.log("\n=== TOP UNKNOWN NAMES ===\n");
  for (const cand of filtered) {
    console.log(`${cand.display} (${cand.count} total, ${cand.primaryCount} primary)`);
    for (const ex of cand.examples) {
      console.log(`  > ${ex}`);
    }
    console.log("");
  }

  if (includeKnown && knownHitsList.length > 0) {
    console.log("\n=== KNOWN NAMES HIT COUNTS ===\n");
    for (const hit of knownHitsList) {
      console.log(`${hit.canonical_name} (${hit.count} total, ${hit.primaryCount} primary)`);
    }
    console.log("");
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Candidates: ${filtered.length}`);
  if (includeKnown) {
    console.log(`Known hits: ${knownHitsList.length}`);
  }

  // Write pending decisions file
  const pendingData: PendingDecisions = {
    version: 1,
    generated_at: new Date().toISOString(),
    source: {
      db: dbPath,
      guildId,
      campaignSlug,
      primaryOnly,
      minCount,
      sessionCount: sessionRows.length,
      transcriptSource,
    },
    pending: filtered,
  };

  const pendingDir = path.dirname(pendingPath);
  if (!fs.existsSync(pendingDir)) {
    fs.mkdirSync(pendingDir, { recursive: true });
  }
  fs.writeFileSync(pendingPath, yaml.stringify(pendingData));
  console.log(`\n✅ Pending decisions written to ${pendingPath}`);
}

// Main
try {
  scanNames();
} catch (err) {
  console.error("[scan-names] ERROR:", err instanceof Error ? err.message : err);
  process.exit(1);
}
