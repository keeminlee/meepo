import { loadRegistry } from "./loadRegistry.js";
import type { LoadedRegistry } from "./types.js";
import { log } from "../utils/logger.js";

const registryLog = log.withScope("registry");
let warnedMissingRegistry = false;

function tryLoadRegistry(): LoadedRegistry | null {
  try {
    return loadRegistry();
  } catch (err: any) {
    if (!warnedMissingRegistry) {
      warnedMissingRegistry = true;
      registryLog.warn(
        `Registry normalization disabled: ${err?.message ?? err}. Continuing without name normalization.`
      );
    }
    return null;
  }
}

/**
 * Phase 1C: Name Normalization
 * 
 * Replaces entity aliases with canonical names in text.
 * Uses longest-match-first strategy to handle multi-word names.
 * Word-boundary matching ensures we don't break words.
 * 
 * Example:
 *   "Don't worry, Ira, I've got this." 
 *   → "Don't worry, Uriah, I've got this."
 * 
 * @param text Raw STT text
 * @param registry Loaded registry (or will load if not provided)
 * @returns Normalized text with canonical names
 */
export function normalizeText(text: string, registry?: LoadedRegistry): string {
  const reg = registry ?? tryLoadRegistry();
  if (!reg) {
    return text;
  }
  
  // Build list of all name variants (canonical + aliases) with their canonical forms
  type NameEntry = {
    pattern: string;        // The alias/canonical to match
    canonical: string;      // What to replace it with
    wordCount: number;      // For sorting (multi-word first)
    length: number;         // For tie-breaking
  };
  
  const entries: NameEntry[] = [];
  
  for (const [normalizedKey, entity] of reg.byName.entries()) {
    // Find the original text that normalized to this key
    // Check canonical first
    const canonical = entity.canonical_name;
    
    // Add canonical name as a searchable pattern
    entries.push({
      pattern: canonical,
      canonical: canonical,
      wordCount: canonical.split(/\s+/).length,
      length: canonical.length,
    });
    
    // Add all aliases
    if ('aliases' in entity && entity.aliases) {
      for (const alias of entity.aliases) {
        entries.push({
          pattern: alias,
          canonical: canonical,
          wordCount: alias.split(/\s+/).length,
          length: alias.length,
        });
      }
    }
  }
  
  // Sort by word count desc, then length desc
  // This ensures "Jamison Rogers" is checked before "Jamison"
  entries.sort((a, b) => {
    if (a.wordCount !== b.wordCount) {
      return b.wordCount - a.wordCount;
    }
    return b.length - a.length;
  });
  
  // Deduplicate entries (same pattern → same canonical)
  const seen = new Set<string>();
  const uniqueEntries: NameEntry[] = [];
  for (const entry of entries) {
    const key = `${entry.pattern.toLowerCase()}→${entry.canonical}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueEntries.push(entry);
    }
  }
  
  // Apply replacements
  let result = text;
  for (const entry of uniqueEntries) {
    // Skip if pattern is already the canonical (no-op replacement)
    if (entry.pattern === entry.canonical) {
      continue;
    }
    
    // Escape regex special characters
    const escaped = entry.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Word boundary match, case-insensitive
    const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
    
    result = result.replace(regex, entry.canonical);
  }
  
  return result;
}

/**
 * Normalize multiple text segments (batch operation).
 * More efficient than calling normalizeText() repeatedly
 * because registry is loaded once.
 */
export function normalizeTexts(texts: string[]): string[] {
  const registry = tryLoadRegistry();
  if (!registry) {
    return texts;
  }
  return texts.map(t => normalizeText(t, registry));
}
