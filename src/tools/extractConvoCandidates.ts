/**
 * Layer 0: Conversation Candidate Extraction Tool
 *
 * Scans conversation log for "sticky statements" that might become internalized memory.
 * Deterministic pattern matching (no LLM) to flag candidates for offline review.
 *
 * Usage:
 *   npx tsx src/tools/extractConvoCandidates.ts
 *   npx tsx src/tools/extractConvoCandidates.ts --session <session_id>
 *
 * Patterns matched:
 * - "remember this" / "remember that"
 * - "from now on" / "always" / "never"
 * - "don't call me" / "call me"
 * - "secretly" / "the truth is"
 * - "repeat after me" / "Meepo must"
 * - "I told you" / "I said"
 */

import { getDb } from "../db.js";
import { insertCandidate, type ConvoTurn } from "../ledger/meepoConvo.js";

// Patterns that indicate sticky memory candidates
const STICKY_PATTERNS = [
  /\bremember\s+(this|that)\b/i,
  /\bfrom\s+now\s+on\b/i,
  /\balways\b/i,
  /\bnever\b/i,
  /\bdon'?t\s+call\s+me\b/i,
  /\bcall\s+me\b/i,
  /\bsecretly\b/i,
  /\bthe\s+truth\s+is\b/i,
  /\brepeat\s+after\s+me\b/i,
  /\bmeepo\s+must\b/i,
  /\bmeepo\s+should\b/i,
  /\bi\s+told\s+you\b/i,
  /\bi\s+said\b/i,
];

interface ExtractionStats {
  scannedTurns: number;
  newCandidates: number;
  skippedDuplicates: number;
}

/**
 * Scan conversation log for sticky patterns and create candidates.
 *
 * @param session_id - Limit to specific session, or null for all
 * @returns Extraction statistics
 */
function extractCandidates(session_id: string | null): ExtractionStats {
  const db = getDb();
  const stats: ExtractionStats = {
    scannedTurns: 0,
    newCandidates: 0,
    skippedDuplicates: 0,
  };

  // Get all player turns (not Meepo or system)
  const query = session_id
    ? `SELECT * FROM meepo_convo_log WHERE session_id = ? AND role = 'player' ORDER BY ts_ms ASC`
    : `SELECT * FROM meepo_convo_log WHERE role = 'player' ORDER BY ts_ms ASC`;

  const turns = (
    session_id
      ? db.prepare(query).all(session_id)
      : db.prepare(query).all()
  ) as ConvoTurn[];

  console.log(`Scanning ${turns.length} player turns...`);

  for (const turn of turns) {
    stats.scannedTurns++;

    // Check each pattern
    for (const pattern of STICKY_PATTERNS) {
      if (pattern.test(turn.content_raw)) {
        const patternName = pattern.source.replace(/\\\\/g, "").substring(0, 30);
        
        try {
          const candidateId = insertCandidate(
            turn.id,
            "sticky_claim",
            turn.content_raw,
            `Matched pattern: ${patternName}`
          );

          // Check if this was a new insertion or duplicate
          const existingCount = db
            .prepare("SELECT COUNT(*) as count FROM meepo_convo_candidate WHERE source_log_id = ? AND candidate_type = 'sticky_claim'")
            .get(turn.id) as { count: number };

          if (existingCount.count === 1) {
            stats.newCandidates++;
            console.log(`✅ New candidate ${candidateId}: "${turn.content_raw.substring(0, 50)}..."`);
          } else {
            stats.skippedDuplicates++;
          }
        } catch (err: any) {
          console.error(`❌ Failed to insert candidate for turn ${turn.id}: ${err.message}`);
        }

        // Only match first pattern per turn (avoid duplicate candidates)
        break;
      }
    }
  }

  return stats;
}

// ============================================================================
// CLI Entry Point
// ============================================================================

function main() {
  const args = process.argv.slice(2);
  let session_id: string | null = null;

  // Parse --session flag
  const sessionIndex = args.indexOf("--session");
  if (sessionIndex !== -1 && args[sessionIndex + 1]) {
    session_id = args[sessionIndex + 1];
    console.log(`Filtering to session: ${session_id}`);
  } else {
    console.log(`Scanning all sessions`);
  }

  const stats = extractCandidates(session_id);

  console.log(`\n📊 Extraction Summary:`);
  console.log(`   Scanned turns:      ${stats.scannedTurns}`);
  console.log(`   New candidates:     ${stats.newCandidates}`);
  console.log(`   Skipped duplicates: ${stats.skippedDuplicates}`);
  console.log(`\nRun review tool to approve/reject candidates:`);
  console.log(`   npx tsx src/tools/review-convo-memory.ts list`);
}

main();
