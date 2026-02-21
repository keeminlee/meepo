/**
 * Tool: Reset MeepoMind memories
 * 
 * Deletes all existing memories and re-seeds with current INITIAL_MEMORIES.
 * Use this when you've added/changed foundational memories.
 */

import { getDb } from "../../db.js";
import { seedInitialMeepoMemories } from "../../ledger/meepo-mind.js";

console.log("🧹 Resetting MeepoMind memories...\n");

const db = getDb();

// Delete all existing memories
const result = db.prepare("DELETE FROM meepo_mind").run();
console.log(`✅ Deleted ${result.changes} existing memories`);

// Re-seed with current INITIAL_MEMORIES
await seedInitialMeepoMemories();

console.log("\n✅ Done! MeepoMind has been reset with fresh memories.");
