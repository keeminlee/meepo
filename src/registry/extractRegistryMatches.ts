import type { LoadedRegistry, Entity } from "./types.js";

export interface RegistryMatch {
  entity_id: string;
  canonical: string;
  matched_text: string;
}

/**
 * Extract registry entity matches from a user query.
 * - Longest-match-first, exact substring match against canonical names and aliases
 * - Supports multi-word names
 * - Returns distinct matches
 */
export function extractRegistryMatches(queryText: string, registry: LoadedRegistry): RegistryMatch[] {
  const haystack = queryText;
  const candidates: { entity: Entity; name: string }[] = [];

  // Gather all canonical names and aliases for all entities
  for (const group of [registry.characters, registry.locations, registry.factions, registry.misc]) {
    for (const entity of group) {
      candidates.push({ entity, name: entity.canonical_name });
      for (const alias of entity.aliases) {
        candidates.push({ entity, name: alias });
      }
    }
  }

  // Sort candidates by length descending (longest match first)
  candidates.sort((a, b) => b.name.length - a.name.length);

  const found = new Set<string>();
  const matches: RegistryMatch[] = [];

  for (const { entity, name } of candidates) {
    if (!name) continue;
    // Case-insensitive substring match
    const idx = haystack.toLowerCase().indexOf(name.toLowerCase());
    if (idx !== -1) {
      // Avoid duplicate entity matches
      if (!found.has(entity.id)) {
        matches.push({
          entity_id: entity.id,
          canonical: entity.canonical_name,
          matched_text: haystack.substr(idx, name.length),
        });
        found.add(entity.id);
      }
    }
  }

  return matches;
}
