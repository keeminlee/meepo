/**
 * MeepoMind: Database Operations for Meepo's Knowledge Base
 *
 * Handles seeding, retrieval, and formatting of Meepo's memories.
 * Canonical memories are defined in src/meepo/knowledge.ts.
 *
 * Future expansions:
 * - Character-scoped memories (per NPC or party member)
 * - Decay and gravity weighting logic
 * - Retrieval ranking and pruning
 * - Associative links between memories
 */

import { getDb } from "../db.js";
import { randomUUID } from "crypto";
import { INITIAL_MEMORIES } from "../meepo/knowledge.js";
import type { Memory } from "../meepo/knowledge.js";

export type { Memory };

// ============================================================================
// Seeder: One-time initialization
// ============================================================================

/**
 * Seed Meepo's foundational memories (idempotent).
 *
 * - Checks existing memories by title
 * - Inserts any missing memories from INITIAL_MEMORIES
 * - Safe to call on every startup (will add new memories from knowledge.ts)
 *
 * Call this once at bot startup.
 */
export async function seedInitialMeepoMemories(): Promise<void> {
  const db = getDb();

  try {
    // Get existing memory titles
    const existingRows = db.prepare("SELECT title FROM meepo_mind").all() as { title: string }[];
    const existingTitles = new Set(existingRows.map(row => row.title));

    // Find memories that need to be added
    const missingMemories = INITIAL_MEMORIES.filter(mem => !existingTitles.has(mem.title));

    if (missingMemories.length === 0) {
      console.log("MeepoMind: Already seeded (all memories present)");
      return;
    }

    console.log(`MeepoMind: Seeding ${missingMemories.length} new memories...`);

    const now = Date.now();
    const insertStmt = db.prepare(`
      INSERT INTO meepo_mind (id, title, content, gravity, certainty, created_at_ms, last_accessed_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    db.transaction(() => {
      for (const mem of missingMemories) {
        const id = randomUUID();
        insertStmt.run(id, mem.title, mem.content, mem.gravity, mem.certainty, now, null);
      }
    })();

    console.log(`MeepoMind: Seeded ${missingMemories.length} foundational memories`);
  } catch (err: any) {
    console.error("MeepoMind: Seeding failed:", err.message ?? err);
    throw err;
  }
}

// ============================================================================
// Retrieval
// ============================================================================

/**
 * Get all Meepo memories, ordered by gravity (descending).
 *
 * Updates last_accessed_at_ms for each retrieved memory.
 *
 * @returns Promise resolving to array of Memory objects
 */
export async function getAllMeepoMemories(): Promise<Memory[]> {
  const db = getDb();

  try {
    const memories = db
      .prepare("SELECT * FROM meepo_mind ORDER BY gravity DESC")
      .all() as Memory[];

    // Update last_accessed_at_ms for each memory
    const now = Date.now();
    const updateStmt = db.prepare(
      "UPDATE meepo_mind SET last_accessed_at_ms = ? WHERE id = ?"
    );

    db.transaction(() => {
      for (const mem of memories) {
        updateStmt.run(now, mem.id);
      }
    })();

    return memories;
  } catch (err: any) {
    console.error("MeepoMind: Retrieval failed:", err.message ?? err);
    throw err;
  }
}

// ============================================================================
// Formatting for Prompt Injection
// ============================================================================

/**
 * Format all memories as a section for injection into Meepo's system prompt.
 *
 * Returns a formatted string suitable for inclusion in the system prompt.
 * If no memories exist, returns an empty string.
 *
 * Format: Numbered list for robustness in system prompts.
 */
export async function getMeepoMemoriesSection(): Promise<string> {
  try {
    const memories = await getAllMeepoMemories();

    if (memories.length === 0) {
      return "";
    }

    // Format as numbered list (more robust in system prompts than bullets)
    const lines = memories
      .map((m, idx) => `${idx + 1}) ${m.title}: ${m.content}`)
      .join("\n");

    return `\nMEEPO KNOWLEDGE BASE (Canonical memories Meepo may reference):\n${lines}\n`;
  } catch (err: any) {
    console.error("MeepoMind: Formatting failed:", err.message ?? err);
    // Return empty string instead of throwing; graceful degradation
    return "";
  }
}

// ============================================================================
// Knowledge Checks
// ============================================================================

/**
 * Check if Meepo knows about a specific topic (by title prefix).
 *
 * ⚠️  EXPERIMENTAL — Naive prefix matching.
 *
 * This function does simple case-insensitive prefix matching on memory titles.
 * It can produce false positives/negatives as the knowledge base grows.
 * Do NOT wire this to core behavior yet; treat as exploratory only.
 *
 * Useful for conditional speech hints (e.g., prefer "Meepo not sure meep"
 * over direct statement when topic is unknown).
 *
 * @param topicPrefix - Case-insensitive prefix to search for in memory titles
 * @returns true if a matching memory exists
 */
export function knowsAbout(topicPrefix: string): boolean {
  const db = getDb();
  const lowerPrefix = topicPrefix.toLowerCase();

  try {
    const result = db
      .prepare("SELECT COUNT(*) as cnt FROM meepo_mind WHERE LOWER(title) LIKE ?")
      .get(`${lowerPrefix}%`) as any;

    return result.cnt > 0;
  } catch (err: any) {
    console.error("MeepoMind: Knowledge check failed:", err.message ?? err);
    return false;
  }
}
