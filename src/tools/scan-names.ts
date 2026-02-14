import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import yaml from "yaml";
import { loadRegistry, normKey } from "../registry/loadRegistry.js";

/**
 * Phase 1B: Name Scanner
 * 
 * Scans SQLite ledger for proper-name candidates, filters against registry,
 * and outputs decisions.pending.yml for manual review.
 * 
 * Usage:
 *   npx tsx src/tools/scan-names.ts --db ./data/test_ingest.sqlite --minCount 3
 */

// Types
type PendingCandidate = {
  key: string; // normalized
  display: string; // most common surface form
  count: number;
  primaryCount: number;
  examples: string[];
};

type PendingDecisions = {
  version: number;
  generated_at: string;
  source: {
    db: string;
    primaryOnly: boolean;
    minCount: number;
  };
  pending: PendingCandidate[];
};

// Constants
const NAME_PHRASE_RE = /\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})*\b/g;

/**
 * Parse command-line arguments (dependency-free).
 */
function parseArgs(): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = process.argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

/**
 * Escape regex special characters.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Main scanner.
 */
function scanNames(): void {
  const args = parseArgs();

  // Resolve parameters
  const dbPath = (args.db as string) || process.env.DB_PATH || "./data/bot.sqlite";
  const minCount = parseInt((args.minCount as string) || "3", 10);
  const primaryOnly = args.primaryOnly === true || args.primaryOnly === "true";
  const maxExamples = parseInt((args.maxExamples as string) || "3", 10);
  const pendingPath = (args.pendingOut as string) || path.join(process.cwd(), "data", "registry", "decisions.pending.yml");
  const includeKnown = args.includeKnown === true || args.includeKnown === "true";

  console.log(`[scan-names] Loading registry...`);
  const registry = loadRegistry();

  console.log(`[scan-names] Connecting to ${dbPath}...`);
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}`);
  }

  const db = new Database(dbPath, { readonly: true });

  // Build query
  let query = "SELECT content, source, narrative_weight FROM ledger_entries WHERE content IS NOT NULL AND TRIM(content) != ''";
  if (primaryOnly) {
    query += " AND narrative_weight IN ('primary', 'elevated')";
  }

  console.log(`[scan-names] Executing query...`);
  const rows = db.prepare(query).all() as Array<{
    content: string;
    source: string;
    narrative_weight: string;
  }>;

  console.log(`[scan-names] Scanned ${rows.length} rows, extracting candidates...`);

  // Frequency maps
  const candidates = new Map<string, PendingCandidate>();
  const knownHits = new Map<string, { count: number; primaryCount: number }>();

  // Build regex patterns for known names (for separate diagnostic pass)
  const knownNamePatterns = new Map<string, RegExp>();
  for (const char of registry.characters) {
    // Add canonical name
    const canNorm = normKey(char.canonical_name);
    if (canNorm && !knownNamePatterns.has(canNorm)) {
      knownNamePatterns.set(
        canNorm,
        new RegExp(`\\b${escapeRegex(canNorm)}\\b`, "i")
      );
    }

    // Add aliases
    for (const alias of char.aliases) {
      const alNorm = normKey(alias);
      if (alNorm && !knownNamePatterns.has(alNorm)) {
        knownNamePatterns.set(
          alNorm,
          new RegExp(`\\b${escapeRegex(alNorm)}\\b`, "i")
        );
      }
    }
  }

  // Process each row
  let processedCount = 0;
  for (const row of rows) {
    processedCount++;
    const content = row.content.trim();
    const isPrimary = row.narrative_weight === "primary" || row.narrative_weight === "elevated";

    // Extract phrases
    const phrases = content.match(NAME_PHRASE_RE) || [];

    for (const phrase of phrases) {
      const phraseTrimmed = phrase.trim();
      const phraseNorm = normKey(phraseTrimmed);

      // Skip empty normalizations
      if (!phraseNorm) continue;

      // Skip if in ignore list
      if (registry.ignore.has(phraseNorm)) continue;

      // Skip if already in registry (don't count in phrase extraction;
      // will count separately in known-hit pass below)
      if (registry.byName.has(phraseNorm)) continue;

      // Filter: skip if any word is a known canonical name
      const words = phraseNorm.split(/\s+/);
      if (words.some((w) => registry.byName.has(w))) continue;

      // Filter: "The X" pattern (1-2 words after "The")
      if (phraseTrimmed.startsWith("The ")) {
        const restWords = phraseTrimmed.slice(4).split(/\s+/).length;
        if (restWords <= 2) continue;
      }

      // Filter: contains digits or weird punctuation after norm
      if (phraseNorm.match(/\d/) || phraseNorm.match(/[^a-z0-9\s]/i)) {
        continue;
      }

      // Filter: only ignored tokens
      const tokens = phraseNorm.split(/\s+/);
      const allIgnored = tokens.every((t) => registry.ignore.has(t));
      if (allIgnored) continue;

      // Add / update candidate
      if (!candidates.has(phraseNorm)) {
        candidates.set(phraseNorm, {
          key: phraseNorm,
          display: phraseTrimmed,
          count: 0,
          primaryCount: 0,
          examples: [],
        });
      }

      const cand = candidates.get(phraseNorm)!;
      cand.count++;
      if (isPrimary) cand.primaryCount++;

      // Track display form (keep most common raw form)
      if (!cand.display || cand.examples.length === 0) {
        cand.display = phraseTrimmed;
      }

      // Add example
      if (cand.examples.length < maxExamples) {
        cand.examples.push(content);
      }
    }
  }

  // Separate pass: count known hits with word-boundary matching
  // (independent of phrase extraction, more permissive)
  if (includeKnown) {
    db.close();
    const db2 = new Database(dbPath, { readonly: true });
    const rows2 = db2.prepare(query).all() as Array<{
      content: string;
      source: string;
      narrative_weight: string;
    }>;

    for (const row of rows2) {
      const content = row.content.toLowerCase();
      const isPrimary = row.narrative_weight === "primary" || row.narrative_weight === "elevated";

      // Check each known name pattern
      for (const [nameKey, pattern] of knownNamePatterns) {
        if (pattern.test(content)) {
          if (!knownHits.has(nameKey)) {
            knownHits.set(nameKey, { count: 0, primaryCount: 0 });
          }
          const hit = knownHits.get(nameKey)!;
          hit.count++;
          if (isPrimary) hit.primaryCount++;
        }
      }
    }
    db2.close();
  } else {
    db.close();
  }

  // Filter by minCount and sort
  const filtered = Array.from(candidates.values())
    .filter((c) => c.count >= minCount)
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (b.primaryCount !== a.primaryCount) return b.primaryCount - a.primaryCount;
      return a.key.localeCompare(b.key);
    });

  console.log(`[scan-names] Found ${filtered.length} candidates (minCount=${minCount})`);

  // Build known hits list (optional diagnostic)
  const knownHitsList: Array<{ canonical_name: string; count: number; primaryCount: number }> = [];
  if (includeKnown) {
    const seenCharIds = new Set<string>();
    const hitsByCharId = new Map<string, { canonical_name: string; count: number; primaryCount: number }>();

    for (const [key, hits] of knownHits) {
      const entity = registry.byName.get(key);
      if (entity && !seenCharIds.has(entity.id)) {
        let totalCount = 0;
        let totalPrimary = 0;
        
        totalCount += hits.count;
        totalPrimary += hits.primaryCount;
        
        for (const [otherKey, otherHits] of knownHits) {
          if (otherKey !== key) {
            const otherEntity = registry.byName.get(otherKey);
            if (otherEntity && otherEntity.id === entity.id) {
              totalCount += otherHits.count;
              totalPrimary += otherHits.primaryCount;
            }
          }
        }
        
        hitsByCharId.set(entity.id, {
          canonical_name: entity.canonical_name,
          count: totalCount,
          primaryCount: totalPrimary,
        });
        seenCharIds.add(entity.id);
      }
    }

    knownHitsList.push(...hitsByCharId.values());
    knownHitsList.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (b.primaryCount !== a.primaryCount) return b.primaryCount - a.primaryCount;
      return a.canonical_name.localeCompare(b.canonical_name);
    });
  }

  // Console output (unchanged)
  console.log("\n=== TOP UNKNOWN NAMES ===\n");
  for (const cand of filtered) {
    console.log(`${cand.display} (${cand.count} total, ${cand.primaryCount} primary)`);
    for (const ex of cand.examples) {
      console.log(`  > ${ex}`);
    }
    console.log("");
  }

  if (includeKnown && knownHitsList.length > 0) {
    console.log("\n=== KNOWN NAMES HIT COUNTS ===\n");
    for (const hit of knownHitsList) {
      console.log(`${hit.canonical_name} (${hit.count} total, ${hit.primaryCount} primary)`);
    }
    console.log("");
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Candidates: ${filtered.length}`);
  if (includeKnown) {
    console.log(`Known hits: ${knownHitsList.length}`);
  }

  // Write pending decisions file
  const pendingData: PendingDecisions = {
    version: 1,
    generated_at: new Date().toISOString(),
    source: {
      db: dbPath,
      primaryOnly,
      minCount,
    },
    pending: filtered,
  };

  const pendingDir = path.dirname(pendingPath);
  if (!fs.existsSync(pendingDir)) {
    fs.mkdirSync(pendingDir, { recursive: true });
  }
  fs.writeFileSync(pendingPath, yaml.stringify(pendingData));
  console.log(`\n✅ Pending decisions written to ${pendingPath}`);
}

// Main
try {
  scanNames();
} catch (err) {
  console.error("[scan-names] ERROR:", err instanceof Error ? err.message : err);
  process.exit(1);
}
