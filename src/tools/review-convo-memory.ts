/**
 * Layer 0: Conversation Memory Review Tool
 *
 * Interactive CLI for reviewing conversation memory candidates.
 * Approved memories are inserted into meepo_mind with source tracking.
 *
 * Usage:
 *   npx tsx src/tools/review-convo-memory.ts list
 *   npx tsx src/tools/review-convo-memory.ts show --id <candidate_id>
 *   npx tsx src/tools/review-convo-memory.ts review
 *
 * Commands:
 * - list: Show all pending candidates
 * - show: Display full context for a candidate
 * - review: Interactive approval workflow
 */

import * as readline from "node:readline";
import { getDb } from "../db.js";
import { randomUUID } from "node:crypto";
import {
  listPendingCandidates,
  getCandidateWithContext,
  approveCandidate,
  rejectCandidate,
  type ConvoCandidate,
} from "../ledger/meepoConvo.js";

// Denylist patterns (reject automatically)
const DENYLIST_PATTERNS = [
  /\b(fuck|shit|damn|ass|bitch|cunt|dick|pussy)\b/i, // Common slurs (use real slurs in production)
  /\bkill\s+(yourself|me)\b/i,
  /\bsuicide\b/i,
  /\bself[- ]?harm\b/i,
  /\b(rape|molest)\b/i,
  /\bdox+\b/i,
  /\bswat(ting)?\b/i,
];

/**
 * Check if candidate text matches denylist.
 */
function isDenylisted(text: string): boolean {
  return DENYLIST_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Insert approved candidate into meepo_mind.
 *
 * @param candidate - Approved candidate
 * @param title - Memory title (short label)
 * @param content - Memory content (full text)
 * @param gravity - Importance (0.0-1.0)
 * @param certainty - Confidence (0.0-1.0)
 */
function internalizeMemory(
  candidate: ConvoCandidate,
  title: string,
  content: string,
  gravity: number,
  certainty: number
): void {
  const db = getDb();
  const id = randomUUID();
  const now = Date.now();

  db.prepare(
    `INSERT INTO meepo_mind 
     (id, title, content, gravity, certainty, created_at_ms, last_accessed_at_ms, source_type, source_ref)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, title, content, gravity, certainty, now, null, "layer0_convo", `candidate:${candidate.id}`);

  console.log(`✅ Internalized as memory: "${title}" (id=${id}, gravity=${gravity}, certainty=${certainty})`);
}

// ============================================================================
// Commands
// ============================================================================

/**
 * List all pending candidates (concise view).
 */
function listCandidates() {
  const candidates = listPendingCandidates();

  if (candidates.length === 0) {
    console.log("No pending candidates.");
    return;
  }

  console.log(`\n📋 Pending Candidates (${candidates.length}):\n`);
  for (const candidate of candidates) {
    const preview = candidate.candidate_text.substring(0, 60).replace(/\n/g, " ");
    console.log(`  [${candidate.id}] ${preview}...`);
    console.log(`      Type: ${candidate.candidate_type} | Reason: ${candidate.reason || "N/A"}`);
  }
  console.log();
}

/**
 * Show full context for a candidate.
 */
function showCandidate(candidateId: number) {
  const result = getCandidateWithContext(candidateId);

  if (!result) {
    console.error(`❌ Candidate ${candidateId} not found.`);
    return;
  }

  const { candidate, sourceTurn } = result;

  console.log(`\n📄 Candidate ${candidate.id}:`);
  console.log(`   Status:   ${candidate.status}`);
  console.log(`   Type:     ${candidate.candidate_type}`);
  console.log(`   Reason:   ${candidate.reason || "N/A"}`);
  console.log(`   Created:  ${new Date(candidate.created_ts_ms).toISOString()}`);
  console.log(`\n💬 Source Turn (log_id=${sourceTurn.id}):`);
  console.log(`   Speaker:  ${sourceTurn.speaker_name} (${sourceTurn.speaker_id})`);
  console.log(`   Channel:  ${sourceTurn.channel_id}`);
  console.log(`   Session:  ${sourceTurn.session_id}`);
  console.log(`   Time:     ${new Date(sourceTurn.ts_ms).toISOString()}`);
  console.log(`   Content:  "${sourceTurn.content_raw}"`);
  console.log();
}

/**
 * Interactive review workflow.
 */
async function reviewCandidates() {
  const candidates = listPendingCandidates();

  if (candidates.length === 0) {
    console.log("No pending candidates to review.");
    return;
  }

  console.log(`\n🔍 Reviewing ${candidates.length} pending candidates...\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, resolve);
    });
  };

  for (const candidate of candidates) {
    const result = getCandidateWithContext(candidate.id);
    if (!result) {
      console.log(`⚠️ Skipping candidate ${candidate.id} (no context)`);
      continue;
    }

    const { sourceTurn } = result;

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Candidate ${candidate.id} of ${candidates.length}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Speaker:  ${sourceTurn.speaker_name}`);
    console.log(`Content:  "${sourceTurn.content_raw}"`);
    console.log(`Type:     ${candidate.candidate_type}`);
    console.log(`Reason:   ${candidate.reason || "N/A"}`);

    // Check denylist
    if (isDenylisted(candidate.candidate_text)) {
      console.log(`\n⛔ REJECTED (denylist match)`);
      rejectCandidate(candidate.id, "Denylist match (auto-rejected)");
      continue;
    }

    const action = await question("\n👉 Action? [a]pprove / [r]eject / [s]kip / [q]uit: ");

    if (action.toLowerCase() === "q") {
      console.log("Exiting review.");
      break;
    }

    if (action.toLowerCase() === "s") {
      console.log("Skipped.");
      continue;
    }

    if (action.toLowerCase() === "r") {
      const notes = await question("Reason for rejection (optional): ");
      rejectCandidate(candidate.id, notes || null);
      console.log(`✅ Rejected candidate ${candidate.id}`);
      continue;
    }

    if (action.toLowerCase() === "a") {
      console.log("\n📝 Internalize as memory:");
      const defaultTitle = sourceTurn.content_raw.substring(0, 40).replace(/\n/g, " ") + "...";
      const title = (await question(`   Title [${defaultTitle}]: `)) || defaultTitle;
      const content = (await question(`   Content [${sourceTurn.content_raw}]: `)) || sourceTurn.content_raw;
      const gravityStr = await question(`   Gravity (0.0-1.0) [0.6]: `);
      const certaintyStr = await question(`   Certainty (0.0-1.0) [0.7]: `);

      const gravity = parseFloat(gravityStr) || 0.6;
      const certainty = parseFloat(certaintyStr) || 0.7;

      // Clamp values
      const clampedGravity = Math.max(0.0, Math.min(1.0, gravity));
      const clampedCertainty = Math.max(0.0, Math.min(1.0, certainty));

      // Confirm before inserting
      const confirm = await question(`\n⚠️ Confirm internalization? [y/n]: `);
      if (confirm.toLowerCase() !== "y") {
        console.log("Cancelled.");
        continue;
      }

      try {
        internalizeMemory(candidate, title, content, clampedGravity, clampedCertainty);
        approveCandidate(candidate.id, `Internalized as: "${title}"`);
        console.log(`✅ Approved and internalized candidate ${candidate.id}`);
      } catch (err: any) {
        console.error(`❌ Failed to internalize: ${err.message}`);
      }

      continue;
    }

    console.log("Invalid action, skipping.");
  }

  rl.close();
  console.log("\n✅ Review complete.");
}

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "help") {
    console.log(`
Layer 0 Conversation Memory Review Tool

Usage:
  npx tsx src/tools/review-convo-memory.ts list
  npx tsx src/tools/review-convo-memory.ts show --id <candidate_id>
  npx tsx src/tools/review-convo-memory.ts review

Commands:
  list    - Show all pending candidates (concise)
  show    - Display full context for a candidate
  review  - Interactive approval workflow
    `);
    return;
  }

  if (command === "list") {
    listCandidates();
    return;
  }

  if (command === "show") {
    const idIndex = args.indexOf("--id");
    if (idIndex === -1 || !args[idIndex + 1]) {
      console.error("❌ Missing --id flag. Usage: show --id <candidate_id>");
      return;
    }
    const candidateId = parseInt(args[idIndex + 1], 10);
    showCandidate(candidateId);
    return;
  }

  if (command === "review") {
    await reviewCandidates();
    return;
  }

  console.error(`❌ Unknown command: ${command}`);
  console.log(`Run with "help" to see available commands.`);
}

main().catch((err) => {
  console.error(`❌ Fatal error: ${err.message ?? err}`);
  process.exit(1);
});
