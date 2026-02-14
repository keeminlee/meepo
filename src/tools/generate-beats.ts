/**
 * Generate Meecap Beats from Narratives
 * 
 * Reads narrative meecaps from filesystem, extracts beats deterministically,
 * and writes to filesystem and/or database.
 * 
 * Usage:
 *   npx tsx src/tools/generate-beats.ts --source meecaps --db
 *   npx tsx src/tools/generate-beats.ts --source gptcaps --force
 *   npx tsx src/tools/generate-beats.ts --source meecaps --session C2E6
 * 
 * Args:
 *   --source meecaps|gptcaps (default: meecaps)
 *   --db (only for meecaps: insert into meecap_beats table)
 *   --force (overwrite existing beats)
 *   --session {sessionId} (process only one session)
 */

import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { buildBeatsJsonFromNarrative } from "../sessions/meecap.js";

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
 * Extract sessionId from filename (e.g., "meecap_C2E6.md" → "C2E6")
 */
function extractSessionIdFromFilename(filename: string): string | null {
  const match = filename.match(/meecap[_-]?([^.]+)\.md$/i);
  return match ? match[1] : null;
}

/**
 * Look up the actual UUID session_id from the database using the label (e.g., "C2E6").
 * Returns null if not found.
 */
function resolveSessionIdByLabel(db: Database.Database, label: string): string | null {
  try {
    const stmt = db.prepare("SELECT session_id FROM sessions WHERE label = ? ORDER BY created_at_ms DESC LIMIT 1");
    const row = stmt.get(label) as { session_id: string } | undefined;
    return row ? row.session_id : null;
  } catch (err) {
    return null;
  }
}

/**
 * Main beat generation pipeline.
 */
async function generateBeats(): Promise<void> {
  const args = parseArgs();

  // Parse arguments
  const source = (args.source as string) || "meecaps";
  const useDb = args.db === true || args.db === "true";
  const force = args.force === true || args.force === "true";
  const filterSession = (args.session as string) || null;

  // Validate source
  if (!["meecaps", "gptcaps"].includes(source)) {
    console.error(`❌ Invalid source: ${source}. Must be 'meecaps' or 'gptcaps'.`);
    process.exit(1);
  }

  // Validate DB flag (only valid for meecaps)
  if (useDb && source !== "meecaps") {
    console.error(`❌ --db flag only valid for meecaps source`);
    process.exit(1);
  }

  const narrativesDir = path.join(process.cwd(), "data", source, "narratives");
  const beatsDir = path.join(process.cwd(), "data", source, "beats");

  // Validate directories exist
  if (!fs.existsSync(narrativesDir)) {
    console.error(`❌ Narratives directory not found: ${narrativesDir}`);
    process.exit(1);
  }

  // Create beats directory if needed
  if (!fs.existsSync(beatsDir)) {
    fs.mkdirSync(beatsDir, { recursive: true });
  }

  // Open database if using --db flag
  let db: Database.Database | null = null;
  if (useDb) {
    const dbPath = path.join(process.cwd(), "data", "bot.sqlite");
    if (!fs.existsSync(dbPath)) {
      console.error(`❌ Database not found: ${dbPath}`);
      process.exit(1);
    }
    db = new Database(dbPath);
  }

  console.log(`\n📖 Generating beats from ${source} narratives`);
  console.log(`   Source: ${narrativesDir}`);
  console.log(`   Output: ${beatsDir}`);
  if (useDb) console.log(`   Mode: Filesystem + Database`);
  else console.log(`   Mode: Filesystem only`);
  if (filterSession) console.log(`   Filter: ${filterSession}`);
  if (force) console.log(`   Force: Overwrite existing`);
  console.log("");

  // Read narrative files
  const files = fs.readdirSync(narrativesDir).filter((f) => f.endsWith(".md"));

  if (files.length === 0) {
    console.log(`⚠️  No narrative files found in ${narrativesDir}`);
    return;
  }

  let processed = 0;
  let skipped = 0;
  let succeeded = 0;
  let failed = 0;
  const failedSessions: { sessionId: string; error: string }[] = [];

  for (const filename of files) {
    let labelOrSessionId = extractSessionIdFromFilename(filename);
    if (!labelOrSessionId) {
      console.log(`⚠️  NAMING DRIFT: Skipping "${filename}" (cannot extract session ID from pattern meecap_*.md)`);
      skipped++;
      continue;
    }

    // For meecaps with DB, resolve label to actual UUID session_id
    let sessionId = labelOrSessionId;
    if (useDb && db) {
      const resolvedId = resolveSessionIdByLabel(db, labelOrSessionId);
      if (!resolvedId) {
        console.log(`⚠️  ${labelOrSessionId}: No matching session found in DB (label mismatch?)`);
        skipped++;
        continue;
      }
      sessionId = resolvedId;
    }

    // Filter by session if specified
    if (filterSession && labelOrSessionId !== filterSession) {
      continue;
    }

    // Check if beats already exist
    const beatsPath = path.join(beatsDir, `beats_${labelOrSessionId}.json`);
    if (fs.existsSync(beatsPath) && !force) {
      console.log(`⏭️  ${labelOrSessionId}: beats already exist (use --force to overwrite)`);
      skipped++;
      continue;
    }

    // Read narrative file
    const narrativePath = path.join(narrativesDir, filename);
    let narrative: string;
    try {
      narrative = fs.readFileSync(narrativePath, "utf-8");
    } catch (err: any) {
      console.error(`❌ ${labelOrSessionId}: Failed to read narrative file: ${err.message}`);
      failed++;
      failedSessions.push({ sessionId, error: `Read failed: ${err.message}` });
      continue;
    }

    // Build beats from narrative
    const result = buildBeatsJsonFromNarrative({
      sessionId,
      lineCount: 1000, // Placeholder; lineCount is used for validation, narratives reference their own line count
      narrative,
      entries: undefined,
      label: labelOrSessionId,
      insertToDB: useDb,
    });

    if (!result.ok) {
      console.error(`❌ ${labelOrSessionId}: Failed to generate beats: ${result.error}`);
      failed++;
      failedSessions.push({ sessionId: labelOrSessionId, error: result.error });
      continue;
    }

    // Write beats JSON to filesystem
    try {
      fs.writeFileSync(beatsPath, JSON.stringify(result.beats, null, 2), "utf-8");
      console.log(`✅ ${labelOrSessionId}: Generated ${result.beats.beats.length} beats → beats_${labelOrSessionId}.json`);
      succeeded++;
    } catch (err: any) {
      console.error(`❌ ${labelOrSessionId}: Failed to write beats file: ${err.message}`);
      failed++;
      failedSessions.push({ sessionId: labelOrSessionId, error: `Write failed: ${err.message}` });
      continue;
    }

    processed++;
  }

  // Report summary
  console.log("\n" + "=".repeat(60));
  console.log(`📊 Summary:`);
  console.log(`   Processed: ${processed}`);
  console.log(`   Succeeded: ${succeeded}`);
  console.log(`   Failed: ${failed}`);
  console.log(`   Skipped: ${skipped}`);

  if (failedSessions.length > 0) {
    console.log(`\n❌ Failed sessions:`);
    for (const { sessionId, error } of failedSessions) {
      console.log(`   - ${sessionId}: ${error}`);
    }
  }

  // Close database connection
  if (db) {
    db.close();
  }

  if (failed > 0) {
    process.exit(1);
  }
}

generateBeats().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
