/**
 * Cleanup and Normalize Existing Transcripts
 * 
 * 1. Removes <|vq_hbr_audio_XXXX|> Whisper codec artifacts from ledger_entries.content
 * 2. Re-normalizes all content with the current registry (updates content_norm)
 * 
 * Use this after updating the registry or fixing transcription issues.
 * 
 * Usage:
 *   tsx tools/cleanup-and-normalize-transcripts.ts [--dbPath <path>] [--dryRun] [--sessionLabel <label>]
 * 
 * Options:
 *   --dbPath <path>         Database to clean (default: ./data/bot.sqlite)
 *   --sessionLabel <label>  Only process specific session (e.g., C2E1)
 *   --dryRun                Show what would be changed without modifying DB
 */

import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { normalizeText } from "../src/registry/normalizeText.js";

interface CliArgs {
  dbPath: string;
  sessionLabel?: string;
  dryRun: boolean;
}

function parseArgs(): CliArgs {
  const args: CliArgs = {
    dbPath: "./data/bot.sqlite",
    dryRun: false,
  };

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];

    if (arg === "--dryRun") {
      args.dryRun = true;
    } else if (arg === "--dbPath" && process.argv[i + 1]) {
      args.dbPath = process.argv[i + 1];
      i++;
    } else if (arg === "--sessionLabel" && process.argv[i + 1]) {
      args.sessionLabel = process.argv[i + 1];
      i++;
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  return args;
}

function cleanTranscript(text: string): string {
  return text.replace(/<\|vq_hbr_audio_\d+\|>/g, '').trim();
}

function main(): void {
  const args = parseArgs();

  if (!existsSync(args.dbPath)) {
    console.error(`❌ Database not found: ${args.dbPath}`);
    process.exit(1);
  }

  console.log(`📂 Opening database: ${args.dbPath}`);
  const db = new Database(args.dbPath);
  db.pragma("journal_mode = WAL");

  // Build query based on filters
  let whereClause = "WHERE source = 'offline_ingest'";
  const params: any[] = [];
  
  if (args.sessionLabel) {
    whereClause += " AND session_id IN (SELECT session_id FROM sessions WHERE label = ?)";
    params.push(args.sessionLabel);
  }

  // Find all ledger entries from ingested sessions
  const selectStmt = db.prepare(`
    SELECT id, content, content_norm, session_id, timestamp_ms
    FROM ledger_entries
    ${whereClause}
    ORDER BY timestamp_ms
  `);

  const allRows = selectStmt.all(...params) as Array<{
    id: string;
    content: string;
    content_norm: string | null;
    session_id: string;
    timestamp_ms: number;
  }>;

  if (allRows.length === 0) {
    console.log("✅ No entries found to process");
    db.close();
    return;
  }

  console.log(`\n🔍 Found ${allRows.length} entries to process\n`);

  // Analyze what needs updating
  const artifactRows = allRows.filter(r => r.content.includes('<|vq_hbr_audio_'));
  const needsNormalization = allRows;  // Re-normalize all with current registry

  // Group by session for summary
  const bySession = new Map<string, { total: number; artifacts: number }>();
  for (const row of allRows) {
    const stats = bySession.get(row.session_id) || { total: 0, artifacts: 0 };
    stats.total++;
    if (row.content.includes('<|vq_hbr_audio_')) {
      stats.artifacts++;
    }
    bySession.set(row.session_id, stats);
  }

  console.log("Sessions to process:");
  for (const [sessionId, stats] of bySession.entries()) {
    // Get session label for readability
    const labelRow = db.prepare("SELECT label FROM sessions WHERE session_id = ?").get(sessionId) as { label?: string } | undefined;
    const label = labelRow?.label || sessionId.substring(0, 8);
    console.log(`  - ${label}: ${stats.total} entries (${stats.artifacts} with artifacts)`);
  }

  console.log(`\n📊 Summary:`);
  console.log(`  - Total entries: ${allRows.length}`);
  console.log(`  - Entries with artifacts: ${artifactRows.length}`);
  console.log(`  - Entries to re-normalize: ${needsNormalization.length}`);

  if (args.dryRun) {
    console.log("\n🏁 DRY RUN - showing sample changes:\n");
    
    // Show artifact cleanup example if any exist
    if (artifactRows.length > 0) {
      const sample = artifactRows[0];
      const cleaned = cleanTranscript(sample.content);
      const artifactCount = (sample.content.match(/<\|vq_hbr_audio_\d+\|>/g) || []).length;
      
      console.log("🧹 Artifact Cleanup Example:");
      console.log(`  Entry ID: ${sample.id.substring(0, 8)}...`);
      console.log(`  Artifacts: ${artifactCount} tokens`);
      console.log(`  Original length: ${sample.content.length} chars`);
      console.log(`  Cleaned length: ${cleaned.length} chars`);
      console.log(`  Before: ${sample.content.substring(0, 80)}...`);
      console.log(`  After:  ${cleaned.substring(0, 80)}...\n`);
    }

    // Show normalization example
    const normSample = allRows[0];
    const newNorm = normalizeText(cleanTranscript(normSample.content));
    console.log("📝 Normalization Example:");
    console.log(`  Entry ID: ${normSample.id.substring(0, 8)}...`);
    console.log(`  Old content_norm: ${normSample.content_norm?.substring(0, 80) || '(null)'}...`);
    console.log(`  New content_norm: ${newNorm.substring(0, 80)}...\n`);

    console.log(`Run without --dryRun to apply changes to ${allRows.length} entries`);
    db.close();
    return;
  }

  // Apply cleanup and normalization
  console.log("\n🧹 Processing transcripts...\n");
  const updateStmt = db.prepare("UPDATE ledger_entries SET content = ?, content_norm = ? WHERE id = ?");

  let artifactsRemoved = 0;
  let normalized = 0;

  db.transaction(() => {
    for (const row of allRows) {
      const cleaned = cleanTranscript(row.content);
      const newNorm = normalizeText(cleaned);
      
      updateStmt.run(cleaned, newNorm, row.id);
      
      if (row.content !== cleaned) artifactsRemoved++;
      normalized++;
    }
  })();

  console.log(`✅ Processing complete:`);
  console.log(`  - Artifacts removed: ${artifactsRemoved} entries`);
  console.log(`  - Normalized: ${normalized} entries`);
  
  // Verify no artifacts remain
  const remaining = db.prepare("SELECT COUNT(*) as count FROM ledger_entries WHERE content LIKE '%<|vq_hbr_audio_%'").get() as { count: number };
  
  if (remaining.count > 0) {
    console.warn(`⚠️  Warning: ${remaining.count} entries still have artifacts (possible issue)`);
  } else {
    console.log("✅ All artifacts removed successfully");
  }

  db.close();
}

main();
