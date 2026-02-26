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

import { getDbForCampaign } from "../db.js";
import { getDefaultCampaignSlug } from "../campaign/defaultCampaign.js";
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

/** Returns true when DB row and seed memory differ on content, gravity, or certainty (title already matched). */
function seedMemoryContentDiffers(
  row: { content: string; gravity: number; certainty: number },
  mem: { content: string; gravity: number; certainty: number }
): boolean {
  return row.content !== mem.content || row.gravity !== mem.gravity || row.certainty !== mem.certainty;
}

/**
 * Sync DB to match the canonical seed list: match by title, diff by title + content (and gravity/certainty).
 * - Insert when no row with that title exists.
 * - Update when title exists but content (or gravity/certainty) differs, so content tweaks in knowledge.ts are applied.
 * - Remove DB rows whose title is no longer in the seed list.
 */
function seedIntoMindspace(
  db: ReturnType<typeof getDbForCampaign>,
  mindspace: string,
  memories: { title: string; content: string; gravity: number; certainty: number }[],
  now: number
): { inserted: number; updated: number; removed: number } {
  const insertStmt = db.prepare(`
    INSERT INTO meepo_mind (id, mindspace, title, content, gravity, certainty, created_at_ms, last_accessed_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateStmt = db.prepare(`
    UPDATE meepo_mind SET content = ?, gravity = ?, certainty = ? WHERE mindspace = ? AND title = ?
  `);
  const existingRows = db.prepare("SELECT id, title, content, gravity, certainty FROM meepo_mind WHERE mindspace = ?").all(mindspace) as {
    id: string;
    title: string;
    content: string;
    gravity: number;
    certainty: number;
  }[];
  const seedTitles = new Set(memories.map(m => m.title));
  const existingByTitle = new Map(existingRows.map(r => [r.title, r]));

  let inserted = 0;
  let updated = 0;
  for (const mem of memories) {
    const row = existingByTitle.get(mem.title);
    if (!row) {
      insertStmt.run(randomUUID(), mindspace, mem.title, mem.content, mem.gravity, mem.certainty, now, null);
      inserted++;
    } else if (seedMemoryContentDiffers(row, mem)) {
      updateStmt.run(mem.content, mem.gravity, mem.certainty, mindspace, mem.title);
      updated++;
    }
  }

  const toRemove = existingRows.filter(r => !seedTitles.has(r.title));
  let removed = 0;
  if (toRemove.length > 0) {
    const deleteStmt = db.prepare("DELETE FROM meepo_mind WHERE id = ?");
    for (const r of toRemove) {
      deleteStmt.run(r.id);
      removed++;
    }
  }

  return { inserted, updated, removed };
}

function resolveMeepoMindDb(db?: ReturnType<typeof getDbForCampaign>): ReturnType<typeof getDbForCampaign> {
  return db ?? getDbForCampaign(getDefaultCampaignSlug());
}

/**
 * Seed Meepo's foundational memories per persona (idempotent).
 * - seed:meta → META_INITIAL_MEMORIES (meta_meepo)
 * - seed:rei → REI_INITIAL_MEMORIES (rei)
 * - campaign:global:legacy → INITIAL_MEMORIES (diegetic_meepo / xoblob)
 * Safe to call on every startup.
 */
/**
 * Seed Meepo's foundational memories per persona (sync with knowledge.ts).
 * - seed:meta → META_INITIAL_MEMORIES (meta_meepo)
 * - seed:rei → REI_INITIAL_MEMORIES (rei)
 * - campaign:global:legacy → INITIAL_MEMORIES (diegetic_meepo / xoblob)
 * Updates existing rows when content/gravity/certainty change; inserts new; removes DB rows no longer in seed.
 * Safe to call on every startup.
 */
export async function seedInitialMeepoMemories(db?: ReturnType<typeof getDbForCampaign>): Promise<void> {
  const conn = resolveMeepoMindDb(db);
  const now = Date.now();

  try {
    const meta = seedIntoMindspace(conn, SEED_MINDSPACE_META, META_INITIAL_MEMORIES, now);
    const rei = seedIntoMindspace(conn, SEED_MINDSPACE_REI, REI_INITIAL_MEMORIES, now);
    const diegetic = seedIntoMindspace(conn, DIEGETIC_LEGACY_MINDSPACE, INITIAL_MEMORIES, now);

    const total = meta.inserted + meta.updated + meta.removed + rei.inserted + rei.updated + rei.removed + diegetic.inserted + diegetic.updated + diegetic.removed;
    if (total > 0) {
      meepoMindLog.info(
        `Seeded memories: meta +${meta.inserted} ~${meta.updated} -${meta.removed} | rei +${rei.inserted} ~${rei.updated} -${rei.removed} | diegetic +${diegetic.inserted} ~${diegetic.updated} -${diegetic.removed}`
      );
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
export async function getMemoriesByMindspace(mindspace: string, db?: ReturnType<typeof getDbForCampaign>): Promise<Memory[]> {
  const conn = resolveMeepoMindDb(db);

  try {
    const stmt = conn.prepare(`
      SELECT id, mindspace, title, content, gravity, certainty, created_at_ms, last_accessed_at_ms
      FROM meepo_mind
      WHERE mindspace = ?
      ORDER BY gravity DESC
    `);
    const memories = stmt.all(mindspace) as Memory[];

    const now = Date.now();
    const updateStmt = conn.prepare(
      "UPDATE meepo_mind SET last_accessed_at_ms = ? WHERE id = ?"
    );
    conn.transaction(() => {
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
export async function getAllMeepoMemories(db?: ReturnType<typeof getDbForCampaign>): Promise<Memory[]> {
  const conn = resolveMeepoMindDb(db);
  const memories = conn
    .prepare("SELECT id, mindspace, title, content, gravity, certainty, created_at_ms, last_accessed_at_ms FROM meepo_mind ORDER BY gravity DESC")
    .all() as Memory[];
  const now = Date.now();
  const updateStmt = conn.prepare("UPDATE meepo_mind SET last_accessed_at_ms = ? WHERE id = ?");
  conn.transaction(() => {
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
  db?: ReturnType<typeof getDbForCampaign>;
}): Promise<MeepoMemoriesSectionResult> {
  try {
    let memories = await getMemoriesByMindspace(opts.mindspace, opts.db);
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
      const seedMemories = await getMemoriesByMindspace(seedMindspace, opts.db);
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
      const legacy = await getMemoriesByMindspace(DIEGETIC_LEGACY_MINDSPACE, opts.db);
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
export function knowsAbout(topicPrefix: string, db?: ReturnType<typeof getDbForCampaign>): boolean {
  const conn = resolveMeepoMindDb(db);
  const lowerPrefix = topicPrefix.toLowerCase();

  try {
    const result = conn
      .prepare("SELECT COUNT(*) as cnt FROM meepo_mind WHERE LOWER(title) LIKE ?")
      .get(`${lowerPrefix}%`) as any;

    return result.cnt > 0;
  } catch (err: any) {
    meepoMindLog.error(`Knowledge check failed: ${err.message ?? err}`);
    return false;
  }
}
