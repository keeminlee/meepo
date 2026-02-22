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
import { log } from "../utils/logger.js";
import { randomUUID } from "crypto";

const meepoMindLog = log.withScope("meepo-mind");
import { INITIAL_MEMORIES, META_INITIAL_MEMORIES, REI_INITIAL_MEMORIES } from "../meepo/knowledge.js";
import type { Memory } from "../meepo/knowledge.js";

export type { Memory };

// ============================================================================
// Seeder: One-time initialization
// ============================================================================

/** Mindspace for in-world foundational memories (Diegetic Meepo). V0 legacy scope. */
export const DIEGETIC_LEGACY_MINDSPACE = "campaign:global:legacy";

/** Mindspace for meta (companion) persona seeded memories. */
export const SEED_MINDSPACE_META = "seed:meta";

/** Mindspace for Rei persona seeded memories. */
export const SEED_MINDSPACE_REI = "seed:rei";

function seedIntoMindspace(
  db: ReturnType<typeof getDb>,
  mindspace: string,
  memories: { title: string; content: string; gravity: number; certainty: number }[],
  insertStmt: ReturnType<ReturnType<typeof getDb>["prepare"]>,
  now: number
): number {
  const existingRows = db.prepare("SELECT title FROM meepo_mind WHERE mindspace = ?").all(mindspace) as { title: string }[];
  const existingTitles = new Set(existingRows.map(row => row.title));
  const missing = memories.filter(mem => !existingTitles.has(mem.title));
  for (const mem of missing) {
    insertStmt.run(randomUUID(), mindspace, mem.title, mem.content, mem.gravity, mem.certainty, now, null);
  }
  return missing.length;
}

/**
 * Seed Meepo's foundational memories per persona (idempotent).
 * - seed:meta → META_INITIAL_MEMORIES (meta_meepo)
 * - seed:rei → REI_INITIAL_MEMORIES (rei)
 * - campaign:global:legacy → INITIAL_MEMORIES (diegetic_meepo / xoblob)
 * Safe to call on every startup.
 */
export async function seedInitialMeepoMemories(): Promise<void> {
  const db = getDb();
  const now = Date.now();
  const insertStmt = db.prepare(`
    INSERT INTO meepo_mind (id, mindspace, title, content, gravity, certainty, created_at_ms, last_accessed_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  try {
    const nMeta = seedIntoMindspace(db, SEED_MINDSPACE_META, META_INITIAL_MEMORIES, insertStmt, now);
    const nRei = seedIntoMindspace(db, SEED_MINDSPACE_REI, REI_INITIAL_MEMORIES, insertStmt, now);
    const nDiegetic = seedIntoMindspace(db, DIEGETIC_LEGACY_MINDSPACE, INITIAL_MEMORIES, insertStmt, now);

    if (nMeta + nRei + nDiegetic > 0) {
      meepoMindLog.info(`Seeded memories: meta=${nMeta} rei=${nRei} diegetic=${nDiegetic}`);
    }
  } catch (err: any) {
    meepoMindLog.error(`Seeding failed: ${err.message ?? err}`);
    throw err;
  }
}

// ============================================================================
// Retrieval
// ============================================================================

/**
 * Get Meepo memories for a mindspace, ordered by gravity (descending).
 * Updates last_accessed_at_ms for each retrieved memory.
 */
export async function getMemoriesByMindspace(mindspace: string): Promise<Memory[]> {
  const db = getDb();

  try {
    const stmt = db.prepare(`
      SELECT id, mindspace, title, content, gravity, certainty, created_at_ms, last_accessed_at_ms
      FROM meepo_mind
      WHERE mindspace = ?
      ORDER BY gravity DESC
    `);
    const memories = stmt.all(mindspace) as Memory[];

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
    meepoMindLog.error(`Retrieval failed: ${err.message ?? err}`);
    throw err;
  }
}

/**
 * Get all Meepo memories (no mindspace filter). For backward compatibility / admin tools.
 */
export async function getAllMeepoMemories(): Promise<Memory[]> {
  const db = getDb();
  const memories = db
    .prepare("SELECT id, mindspace, title, content, gravity, certainty, created_at_ms, last_accessed_at_ms FROM meepo_mind ORDER BY gravity DESC")
    .all() as Memory[];
  const now = Date.now();
  const updateStmt = db.prepare("UPDATE meepo_mind SET last_accessed_at_ms = ? WHERE id = ?");
  db.transaction(() => {
    for (const mem of memories) {
      updateStmt.run(now, mem.id);
    }
  })();
  return memories;
}

// ============================================================================
// Formatting for Prompt Injection
// ============================================================================

export type MeepoMemoriesSectionResult = {
  section: string;
  memoryRefs: string[];
};

/**
 * Format memories for a mindspace as a section for injection into the system prompt.
 * Merges persona-scoped seed memories (seed:meta, seed:rei, campaign:global:legacy) when personaId is set.
 *
 * @param opts.mindspace - Scope: meta:<guild_id> or campaign:<guild_id>:<session_id>
 * @param opts.includeLegacy - If true (campaign diegetic/xoblob), also include campaign:global:legacy
 * @param opts.personaId - When set, also merge the corresponding seed:meta or seed:rei for that persona
 */
export async function getMeepoMemoriesSection(opts: {
  mindspace: string;
  includeLegacy?: boolean;
  personaId?: string;
}): Promise<MeepoMemoriesSectionResult> {
  try {
    let memories = await getMemoriesByMindspace(opts.mindspace);
    const refs: string[] = [...memories.map(m => m.id)];
    const seen = new Set(memories.map(m => m.id));

    // Persona-scoped seed: merge the right seed mindspace for this persona
    let seedMindspace: string | null = null;
    if (opts.personaId === "meta_meepo") {
      seedMindspace = SEED_MINDSPACE_META;
    } else if (opts.personaId === "rei") {
      seedMindspace = SEED_MINDSPACE_REI;
    }
    if (seedMindspace && opts.mindspace !== seedMindspace) {
      const seedMemories = await getMemoriesByMindspace(seedMindspace);
      for (const m of seedMemories) {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          memories = [...memories, m];
          refs.push(m.id);
        }
      }
    }

    // Campaign personas: include diegetic legacy seed
    if (opts.includeLegacy && opts.mindspace !== DIEGETIC_LEGACY_MINDSPACE) {
      const legacy = await getMemoriesByMindspace(DIEGETIC_LEGACY_MINDSPACE);
      for (const m of legacy) {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          memories = [...memories, m];
          refs.push(m.id);
        }
      }
    }

    memories.sort((a, b) => b.gravity - a.gravity);

    if (memories.length === 0) {
      return { section: "", memoryRefs: [] };
    }

    const lines = memories
      .map((m, idx) => `${idx + 1}) ${m.title}: ${m.content}`)
      .join("\n");
    const section = `\nMEEPO KNOWLEDGE BASE (Canonical memories Meepo may reference):\n${lines}\n`;

    return { section, memoryRefs: refs };
  } catch (err: any) {
    meepoMindLog.error(`Formatting failed: ${err.message ?? err}`);
    return { section: "", memoryRefs: [] };
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
    meepoMindLog.error(`Knowledge check failed: ${err.message ?? err}`);
    return false;
  }
}
