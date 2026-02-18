/**
 * label-scaffold.ts: Label scaffold spans via LLM.
 *
 * CLI:
 *   npx tsx src/tools/label-scaffold.ts --session C2E20 [--batch-size 10] [--dry-run]
 *
 * Workflow:
 * 1. Load scaffold (deterministic spans)
 * 2. Load transcript
 * 3. Batch into groups of 10
 * 4. Generate excerpts for each batch
 * 5. Call LLM to label (title, type, is_ooc, participants)
 * 6. Join labels back to scaffold
 * 7. Print summary (no DB writes yet)
 *
 * Output:
 * - Console: structured logs + summary
 * - Artifact (optional): JSON file with labeled events
 */

import "dotenv/config";
import { getDb } from "../db.js";
import {
  getOfficialSessionByLabel,
  getOfficialSessionLabels,
} from "../sessions/officialSessions.js";
import { buildTranscript } from "../ledger/transcripts.js";
import { batchScaffold, getBatchStats } from "../ledger/scaffoldBatcher.js";
import { buildExcerpt, estimateTokens } from "../ledger/scaffoldExcerpt.js";
import { labelScaffoldBatch } from "../ledger/scaffoldLabel.js";
import { applyLabels } from "../ledger/scaffoldJoin.js";
import { MetricsCollector } from "../ledger/scaffoldMetrics.js";
import { persistLabeledEvents } from "../ledger/scaffoldPersist.js";
import type { EventScaffoldBatch } from "../ledger/scaffoldBatchTypes.js";

// ── CLI ───────────────────────────────────────────────────────────────────

function parseArgs(): {
  sessionLabel: string | null;
  batchSize: number;
  dryRun: boolean;
  verbose: boolean;
  force: boolean;
} {
  const args = process.argv.slice(2);
  let sessionLabel: string | null = null;
  let batchSize = 10;
  let dryRun = false;
  let verbose = false;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--session" && args[i + 1]) {
      sessionLabel = args[i + 1];
      i++;
    } else if (arg === "--batch-size" && args[i + 1]) {
      batchSize = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--verbose") {
      verbose = true;
    } else if (arg === "--force") {
      force = true;
    }
  }

  return { sessionLabel, batchSize, dryRun, verbose, force };
}

// ── Load scaffold from DB ──────────────────────────────────────────────────

interface ScaffoldRow {
  event_id: string;
  session_id: string;
  start_index: number;
  end_index: number;
  boundary_reason: string;
  confidence: number;
  dm_ratio: number;
  signal_hits: string;
  compiled_at_ms: number;
}

function loadScaffold(sessionId: string): any[] {
  const db = getDb();
  return (
    db
      .prepare(
        `SELECT event_id, session_id, start_index, end_index, boundary_reason, 
                confidence, dm_ratio, signal_hits, compiled_at_ms
         FROM event_scaffold
         WHERE session_id = ?
         ORDER BY start_index ASC`
      )
      .all(sessionId) as ScaffoldRow[]
  );
}

// ── Load existing labeled events from DB ──────────────────────────────────

function loadExistingLabeledEvents(sessionId: string): any[] | null {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, event_type, description, start_index, end_index, is_ooc 
       FROM events 
       WHERE session_id = ? 
         AND description LIKE '%[boundary:%' 
       ORDER BY start_index ASC`
    )
    .all(sessionId) as Array<{
      id: string;
      event_type: string;
      description: string;
      start_index: number;
      end_index: number;
      is_ooc: number;
    }>;

  if (rows.length === 0) return null;

  // Parse out the title from description (format: "Title - [boundary:...]")
  return rows.map((row) => {
    const parts = row.description.split(" - [");
    const title = parts[0] || row.description;
    
    return {
      event_id: row.id,
      start_index: row.start_index,
      end_index: row.end_index,
      title: title,
      event_type: row.event_type,
      is_ooc: row.is_ooc === 1,
      boundary_reason: "loaded_from_db",
      dm_ratio: 0,
      participants: [], // Will be repopulated by persistLabeledEvents
    };
  });
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { sessionLabel, batchSize, dryRun, verbose, force } = parseArgs();

  if (!sessionLabel) {
    console.error(
      "Usage: npx tsx src/tools/label-scaffold.ts --session <LABEL> [--batch-size 10] [--dry-run] [--verbose] [--force]"
    );
    console.error("\nOptions:");
    console.error("  --force       Force re-labeling even if events already exist");
    process.exit(1);
  }

  const db = getDb();

  // Look up session
  const session = getOfficialSessionByLabel(db, sessionLabel);
  if (!session) {
    console.error(`❌ Session not found or is test/chat: ${sessionLabel}`);
    process.exit(1);
  }

  console.log(`\n📊 Labeling scaffold for ${session.label} (${session.source})\n`);

  // Load scaffold
  const scaffold = loadScaffold(session.session_id);
  if (scaffold.length === 0) {
    console.log("⚠️  No scaffold found. Run compile-scaffold first.");
    process.exit(1);
  }

  console.log(`✓ Loaded scaffold: ${scaffold.length} spans\n`);

  // Load transcript
  const transcript = buildTranscript(session.session_id, true);
  console.log(`✓ Loaded transcript: ${transcript.length} lines\n`);

  // Check for existing labeled events (unless --force)
  let allLabeled: any[] = [];
  
  if (!force) {
    const existing = loadExistingLabeledEvents(session.session_id);
    if (existing && existing.length > 0) {
      console.log(`✓ Found ${existing.length} existing labeled events in DB`);
      console.log(`  (Skipping LLM, will update participants only)\n`);
      allLabeled = existing;
    }
  }

  // If no existing events or --force, run LLM labeling
  if (allLabeled.length === 0) {
    if (force) {
      console.log(`🔄 --force flag set, re-labeling from scratch\n`);
    }

    // Create batches
    const batches = batchScaffold(
      scaffold,
      session.session_id,
      session.label,
      { batchSize }
    );

    console.log(`✓ Batched into ${batches.length} batch(es)\n`);

    // Metrics collector
    const metrics = new MetricsCollector(session.label, session.source as "live" | "ingest-media");

    // Process each batch
    let successCount = 0;
    let failCount = 0;

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx];

    try {
      // Populate excerpts
      for (const item of batch.items) {
        item.excerpt = buildExcerpt(transcript, item.start_index, item.end_index, {
          maxLines: 60,
        });
      }

      // Call LLM
      const startTime = Date.now();
      const result = await labelScaffoldBatch(
        batch,
        process.env.LLM_MODEL ?? "gpt-4o-mini"
      );
      const latencyMs = Date.now() - startTime;

      // Join labels
      const joinResult = applyLabels(batch, result.labels);

      if (joinResult.missingLabels.length > 0) {
        console.error(
          `❌ [${batch.batch_id}] Missing labels for: ${joinResult.missingLabels.join(", ")}`
        );
        failCount++;
        continue;
      }

      // Collect results
      allLabeled.push(...joinResult.labeled);

      // Record metrics
      metrics.recordBatch(
        batch,
        latencyMs,
        result.attemptCount,
        joinResult.labeled,
        joinResult.missingLabels,
        joinResult.unknownEventIds
      );

      // Print batch log
      const batchMetrics = metrics["batches"]?.[metrics["batches"].length - 1];
      if (batchMetrics) {
        metrics.printBatchLog(batchMetrics);
      }

      successCount++;
    } catch (err) {
      console.error(
        `❌ [${batch.batch_id}] ${err instanceof Error ? err.message : String(err)}\n`
      );
      failCount++;
    }
    }

    // Print summary
    const sessionMetrics = metrics.getSessionMetrics(allLabeled);
    metrics.printSessionSummary(sessionMetrics);
  } // end if (allLabeled.length === 0)

  // Persist to DB and artifact
  if (dryRun) {
    console.log(`🏁 DRY RUN - no changes made to DB or files\n`);
  } else {
    console.log(`💾 Persisting labeled events...\n`);
    const { dbUpserted, artifactPath, textPath } = persistLabeledEvents(
      session.session_id,
      session.label,
      allLabeled,
      { dryRun: false, includeEvents: true }
    );

    console.log(`✅ Persisted:`);
    console.log(`  DB: ${dbUpserted} events upserted to events table`);
    if (artifactPath) {
      console.log(`  JSON: ${artifactPath}`);
    }
    if (textPath) {
      console.log(`  Text: ${textPath}`);
    }
    console.log("");
  }
}

main().catch((err) => {
  console.error(`\n❌ Fatal error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
