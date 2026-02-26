import { normKey } from "./loadRegistry.js";
import type { LoadedRegistry } from "./types.js";

export type ScanSourceRow = {
  content: string;
  narrative_weight: string;
  source?: string;
};

export type PendingCandidate = {
  key: string;
  display: string;
  count: number;
  primaryCount: number;
  examples: string[];
};

export type KnownHitSummary = {
  canonical_name: string;
  count: number;
  primaryCount: number;
};

export type ScanNamesCoreInput = {
  rows: ScanSourceRow[];
  registry: Pick<LoadedRegistry, "characters" | "ignore" | "byName">;
  minCount: number;
  maxExamples: number;
  includeKnown: boolean;
};

export type ScanNamesCoreOutput = {
  pending: PendingCandidate[];
  knownHits: KnownHitSummary[];
};

const NAME_PHRASE_RE = /\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})*\b/g;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isPrimaryWeight(weight: string): boolean {
  return weight === "primary" || weight === "elevated";
}

export function pickTranscriptRows(
  ledgerRows: ScanSourceRow[],
  bronzeRows: ScanSourceRow[],
): { rows: ScanSourceRow[]; source: "ledger_entries" | "bronze_transcript" } {
  if (ledgerRows.length > 0) {
    return { rows: ledgerRows, source: "ledger_entries" };
  }
  return { rows: bronzeRows, source: "bronze_transcript" };
}

export function scanNamesCore(input: ScanNamesCoreInput): ScanNamesCoreOutput {
  const candidates = new Map<string, PendingCandidate>();
  const knownHits = new Map<string, { count: number; primaryCount: number }>();

  const knownNamePatterns = new Map<string, RegExp>();
  for (const character of input.registry.characters) {
    const canonicalKey = normKey(character.canonical_name);
    if (canonicalKey && !knownNamePatterns.has(canonicalKey)) {
      knownNamePatterns.set(canonicalKey, new RegExp(`\\b${escapeRegex(canonicalKey)}\\b`, "i"));
    }

    for (const alias of character.aliases) {
      const aliasKey = normKey(alias);
      if (aliasKey && !knownNamePatterns.has(aliasKey)) {
        knownNamePatterns.set(aliasKey, new RegExp(`\\b${escapeRegex(aliasKey)}\\b`, "i"));
      }
    }
  }

  for (const row of input.rows) {
    const content = row.content.trim();
    const isPrimary = isPrimaryWeight(row.narrative_weight);
    const phrases = content.match(NAME_PHRASE_RE) || [];

    for (const phrase of phrases) {
      const display = phrase.trim();
      const key = normKey(display);
      if (!key) continue;
      if (input.registry.ignore.has(key)) continue;
      if (input.registry.byName.has(key)) continue;

      const words = key.split(/\s+/);
      if (words.some((word) => input.registry.byName.has(word))) continue;

      if (display.startsWith("The ")) {
        const restWords = display.slice(4).split(/\s+/).length;
        if (restWords <= 2) continue;
      }

      if (key.match(/\d/) || key.match(/[^a-z0-9\s]/i)) continue;

      const tokens = key.split(/\s+/);
      const allIgnored = tokens.every((token) => input.registry.ignore.has(token));
      if (allIgnored) continue;

      if (!candidates.has(key)) {
        candidates.set(key, {
          key,
          display,
          count: 0,
          primaryCount: 0,
          examples: [],
        });
      }

      const candidate = candidates.get(key)!;
      candidate.count += 1;
      if (isPrimary) {
        candidate.primaryCount += 1;
      }
      if (candidate.examples.length < input.maxExamples) {
        candidate.examples.push(content);
      }
    }
  }

  if (input.includeKnown) {
    for (const row of input.rows) {
      const content = row.content.toLowerCase();
      const isPrimary = isPrimaryWeight(row.narrative_weight);

      for (const [nameKey, pattern] of knownNamePatterns) {
        if (!pattern.test(content)) continue;

        if (!knownHits.has(nameKey)) {
          knownHits.set(nameKey, { count: 0, primaryCount: 0 });
        }
        const hit = knownHits.get(nameKey)!;
        hit.count += 1;
        if (isPrimary) {
          hit.primaryCount += 1;
        }
      }
    }
  }

  const pending = Array.from(candidates.values())
    .filter((candidate) => candidate.count >= input.minCount)
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (b.primaryCount !== a.primaryCount) return b.primaryCount - a.primaryCount;
      return a.key.localeCompare(b.key);
    });

  const knownByCharacterId = new Map<string, KnownHitSummary>();
  if (input.includeKnown) {
    for (const [nameKey, hits] of knownHits) {
      const entity = input.registry.byName.get(nameKey);
      if (!entity || knownByCharacterId.has(entity.id)) continue;

      let count = 0;
      let primaryCount = 0;
      for (const [otherKey, otherHits] of knownHits) {
        const otherEntity = input.registry.byName.get(otherKey);
        if (!otherEntity || otherEntity.id !== entity.id) continue;
        count += otherHits.count;
        primaryCount += otherHits.primaryCount;
      }

      knownByCharacterId.set(entity.id, {
        canonical_name: (entity as { canonical_name: string }).canonical_name,
        count,
        primaryCount,
      });
    }
  }

  const knownHitsList = Array.from(knownByCharacterId.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    if (b.primaryCount !== a.primaryCount) return b.primaryCount - a.primaryCount;
    return a.canonical_name.localeCompare(b.canonical_name);
  });

  return {
    pending,
    knownHits: knownHitsList,
  };
}