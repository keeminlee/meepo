import "dotenv/config";
import path from "node:path";
import { getDb, getDbForCampaign } from "../../db.js";
import { getDefaultCampaignSlug } from "../../campaign/defaultCampaign.js";
import { cfg } from "../../config/env.js";
import { resolveCampaignDbPath } from "../../dataPaths.js";
import { buildTranscript } from "../../ledger/transcripts.js";

type Args = {
  sessionLabel: string;
  campaign: string;
  dryRun: boolean;
  force: boolean;
};

type SessionRow = Record<string, unknown> & {
  session_id: string;
  label: string;
};

type BronzeRow = Record<string, unknown>;

function parseArgs(): Args {
  const argv = process.argv.slice(2);

  let sessionLabel = "";
  let campaign = getDefaultCampaignSlug();
  let dryRun = false;
  let force = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--session" && argv[i + 1]) {
      sessionLabel = argv[++i];
    } else if (arg === "--campaign" && argv[i + 1]) {
      campaign = argv[++i];
    } else if (arg === "--dry_run") {
      dryRun = true;
    } else if (arg === "--force") {
      force = true;
    }
  }

  if (!sessionLabel) {
    throw new Error("Missing required argument: --session <SESSION_LABEL>");
  }

  return { sessionLabel, campaign, dryRun, force };
}

function getTableColumns(db: any, tableName: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function toInsertSql(tableName: string, columns: string[]): string {
  const placeholders = columns.map(() => "?").join(", ");
  return `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES (${placeholders})`;
}

function verifyContiguousLineIndexes(sessionId: string, db: any): void {
  const lines = buildTranscript(sessionId, { view: "bronze", primaryOnly: true }, db);
  if (lines.length === 0) {
    throw new Error("Verification failed: buildTranscript(view=bronze) returned 0 lines.");
  }

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].line_index !== i) {
      throw new Error(
        `Verification failed: expected contiguous line_index; found line_index=${lines[i].line_index} at position ${i}.`,
      );
    }
  }
}

function main(): void {
  const args = parseArgs();

  const sourceDbPath = path.resolve(cfg.db.path);
  const destDbPath = path.resolve(resolveCampaignDbPath(args.campaign));

  if (sourceDbPath === destDbPath) {
    throw new Error(
      `Source DB and destination campaign DB are the same path (${sourceDbPath}). Migration would be a no-op.`,
    );
  }

  const sourceDb = getDb();
  const destDb = getDbForCampaign(args.campaign);

  const session = sourceDb
    .prepare(
      `SELECT *
       FROM sessions
       WHERE label = ?
       ORDER BY created_at_ms DESC
       LIMIT 1`,
    )
    .get(args.sessionLabel) as SessionRow | undefined;

  if (!session) {
    throw new Error(`Session not found in source DB: ${args.sessionLabel}`);
  }

  const bronzeRows = sourceDb
    .prepare(
      `SELECT *
       FROM bronze_transcript
       WHERE session_id = ?
       ORDER BY line_index ASC`,
    )
    .all(session.session_id) as BronzeRow[];

  if (bronzeRows.length === 0) {
    throw new Error(
      `No bronze_transcript rows found for ${args.sessionLabel} (${session.session_id}) in source DB.`,
    );
  }

  const existingSession = destDb
    .prepare(`SELECT session_id FROM sessions WHERE session_id = ? LIMIT 1`)
    .get(session.session_id) as { session_id: string } | undefined;

  const existingBronzeCount = (
    destDb
      .prepare(`SELECT COUNT(*) as count FROM bronze_transcript WHERE session_id = ?`)
      .get(session.session_id) as { count: number }
  ).count;

  console.log(`\n🔎 Migration plan`);
  console.log(`  Session label: ${args.sessionLabel}`);
  console.log(`  Session id: ${session.session_id}`);
  console.log(`  Source DB: ${sourceDbPath}`);
  console.log(`  Dest DB:   ${destDbPath}`);
  console.log(`  Source bronze rows: ${bronzeRows.length}`);
  console.log(`  Dest existing session: ${existingSession ? "yes" : "no"}`);
  console.log(`  Dest existing bronze rows: ${existingBronzeCount}`);
  console.log(`  Mode: ${args.dryRun ? "dry_run" : "execute"}${args.force ? " + force" : ""}`);

  if (args.dryRun) {
    console.log("\n✅ Dry run complete (no writes performed).\n");
    return;
  }

  if ((existingSession || existingBronzeCount > 0) && !args.force) {
    console.log(
      "\n⏭️  Destination already has this session scope. Use --force to delete-and-recopy session-scoped rows.\n",
    );
    verifyContiguousLineIndexes(session.session_id, destDb);
    return;
  }

  const sessionColumns = getTableColumns(destDb, "sessions");
  const bronzeColumns = getTableColumns(destDb, "bronze_transcript");

  const sourceSessionColumns = getTableColumns(sourceDb, "sessions");
  const sourceBronzeColumns = getTableColumns(sourceDb, "bronze_transcript");

  const sessionCommonCols = sessionColumns.filter((col) => sourceSessionColumns.includes(col));
  const bronzeCommonCols = bronzeColumns.filter((col) => sourceBronzeColumns.includes(col));

  if (sessionCommonCols.length === 0 || bronzeCommonCols.length === 0) {
    throw new Error("No common columns found for sessions or bronze_transcript between source and destination schemas.");
  }

  const insertSession = destDb.prepare(toInsertSql("sessions", sessionCommonCols));
  const insertBronze = destDb.prepare(toInsertSql("bronze_transcript", bronzeCommonCols));

  const tx = destDb.transaction(() => {
    if (args.force) {
      destDb.prepare(`DELETE FROM bronze_transcript WHERE session_id = ?`).run(session.session_id);
      destDb.prepare(`DELETE FROM sessions WHERE session_id = ?`).run(session.session_id);
    }

    const sessionValues = sessionCommonCols.map((col) => session[col]);
    insertSession.run(...sessionValues);

    for (const row of bronzeRows) {
      const values = bronzeCommonCols.map((col) => row[col]);
      insertBronze.run(...values);
    }
  });

  tx();

  const postSession = destDb
    .prepare(`SELECT session_id FROM sessions WHERE session_id = ? LIMIT 1`)
    .get(session.session_id) as { session_id: string } | undefined;

  const postBronzeCount = (
    destDb
      .prepare(`SELECT COUNT(*) as count FROM bronze_transcript WHERE session_id = ?`)
      .get(session.session_id) as { count: number }
  ).count;

  if (!postSession) {
    throw new Error("Post-copy verification failed: session row missing in destination DB.");
  }

  if (postBronzeCount <= 0) {
    throw new Error("Post-copy verification failed: no bronze rows in destination DB.");
  }

  verifyContiguousLineIndexes(session.session_id, destDb);

  console.log("\n✅ Migration complete.");
  console.log(`  Copied session_id: ${session.session_id}`);
  console.log(`  Copied bronze rows: ${postBronzeCount}`);
  console.log("  Verified buildTranscript(view=bronze) contiguous line_index contract.\n");
}

try {
  main();
} catch (err) {
  console.error("\n❌", err instanceof Error ? err.message : String(err));
  process.exit(1);
}
