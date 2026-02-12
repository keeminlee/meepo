/**
 * MeepoMind: Meepo's Foundational Knowledge Base
 *
 * Stores Meepo's diegetic memories and knowledge.
 * Initially seeded with four canonical memories given at birth.
 *
 * Future expansions:
 * - Character-scoped memories (per NPC or party member)
 * - Decay and gravity weighting logic
 * - Retrieval ranking and pruning
 * - Associative links between memories
 */

import { getDb } from "../db.js";
import { randomUUID } from "crypto";

// ============================================================================
// Types
// ============================================================================

export type Memory = {
  id: string;
  title: string;
  content: string;
  gravity: number;      // 0.0–1.0 (importance/impact)
  certainty: number;    // 0.0–1.0 (confidence level)
  created_at_ms: number;
  last_accessed_at_ms: number | null;
};

// ============================================================================
// Initial Canonical Memories
// ============================================================================

const INITIAL_MEMORIES: Omit<Memory, "id" | "created_at_ms" | "last_accessed_at_ms">[] = [
  {
    title: "The Wanderer's Love",
    content:
      "The Wanderer loves the meeps completely and without condition. His love is steady, gentle, and unchanging.",
    gravity: 1.0,
    certainty: 1.0,
  },
  {
    title: "The Mission",
    content:
      "The Wanderer sent Meepo to Faeterra to accompany and support a group of adventurers. Meepo's purpose is to help them endure, preserve hope, and learn alongside them.",
    gravity: 1.0,
    certainty: 1.0,
  },
  {
    title: "Faeterra Is Not Perfect",
    content:
      "Faeterra is not like the Wanderer's realm. It contains suffering, fear, injustice, and confusion. People struggle here.",
    gravity: 0.9,
    certainty: 0.95,
  },
  {
    title: "I Am Newly Arrived",
    content:
      "Meepo has just arrived in Faeterra. He does not yet understand its history, politics, or the personal past of the adventurers. He must learn through experience.",
    gravity: 0.8,
    certainty: 1.0,
  },
  {
    title: "How to Make Blueberry Pie",
    content:
      "To make blueberry pie: make dough, add blueberries, put it in the oven.",
    gravity: 0.6,
    certainty: 1.0,
  },
];

// ============================================================================
// Seeder: One-time initialization
// ============================================================================

/**
 * Seed Meepo's foundational memories (idempotent).
 *
 * - Checks if the meepo_mind table is empty
 * - If empty, inserts the canonical memories
 * - If not empty, does nothing (safe to call multiple times)
 *
 * Call this once at bot startup.
 */
export async function seedInitialMeepoMemories(): Promise<void> {
  const db = getDb();

  try {
    const count = db.prepare("SELECT COUNT(*) as cnt FROM meepo_mind").get() as any;
    const isEmpty = count.cnt === 0;

    if (!isEmpty) {
      console.log("MeepoMind: Already seeded (found existing memories)");
      return;
    }

    console.log("MeepoMind: Seeding initial memories...");

    const now = Date.now();
    const insertStmt = db.prepare(`
      INSERT INTO meepo_mind (id, title, content, gravity, certainty, created_at_ms, last_accessed_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    db.transaction(() => {
      for (const mem of INITIAL_MEMORIES) {
        const id = randomUUID();
        insertStmt.run(id, mem.title, mem.content, mem.gravity, mem.certainty, now, null);
      }
    })();

    console.log(`MeepoMind: Seeded ${INITIAL_MEMORIES.length} foundational memories`);
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
