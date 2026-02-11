/**
 * Test Phase 1C: Verify DB migration and normalization
 */

import { getDb } from "../db.js";
import { appendLedgerEntry } from "../ledger/ledger.js";

console.log("🧪 Testing Phase 1C DB integration...\n");

// Step 1: Initialize DB (triggers migration)
console.log("Step 1: Initializing database (should run migration)...");
const db = getDb();

//Step 2: Verify content_norm column exists
console.log("Step 2: Verifying content_norm column...");
const columns = db.pragma("table_info(ledger_entries)") as any[];
const hasContentNorm = columns.some((col: any) => col.name === "content_norm");

if (hasContentNorm) {
  console.log("✅ content_norm column exists");
} else {
  console.log("❌ content_norm column missing!");
  process.exit(1);
}

// Step 3: Test insert with normalization
console.log("Step 3: Testing ledger insert with normalization...");
appendLedgerEntry({
  guild_id: "test_guild",
  channel_id: "test_channel",
  message_id: "test_phase1c_1",
  author_id: "test_user",
  author_name: "Test User",
  timestamp_ms: Date.now(),
  content: "James and Ira went to Waterdeep",  // Raw text with aliases
  content_norm: "Jamison and Uriah went to Waterdeep", // Normalized
  source: "voice",
  narrative_weight: "primary",
  speaker_id: "test_user",
});

// Step 4: Read back and verify
console.log("Step 4: Reading back entry...");
const entry = db.prepare("SELECT content, content_norm FROM ledger_entries WHERE message_id = ?")
  .get("test_phase1c_1") as any;

if (entry) {
  console.log(`✅ Content (raw):  "${entry.content}"`);
  console.log(`✅ Content (norm): "${entry.content_norm}"`);
} else {
  console.log("❌ Entry not found!");
  process.exit(1);
}

console.log("\n✅ Phase 1C DB integration test passed!");
