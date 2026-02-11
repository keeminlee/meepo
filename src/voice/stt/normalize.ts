/**
 * Post-STT Domain Normalization (Task 3.8)
 *
 * Preserves canonical spelling for key campaign entities without relying on
 * the OpenAI transcription `prompt` parameter (which can be echoed back on
 * short/unclear audio).
 *
 * Uses pure regex-based replacements with word boundaries.
 */

/**
 * Entities to normalize with their canonical spellings.
 * Sorted by length (longest first) to avoid partial collisions.
 */
const ENTITY_MAP: Array<[string, RegExp]> = [
  ["Corah Malora", /\bcorah\s+malora\b/gi],
  ["Xoblob", /\bxoblob\b/gi],
  ["Henroc", /\bhenroc\b/gi],
  ["Meepo", /\bmeepo\b/gi],
  ["Kayn", /\bkayn\b/gi],
];

/**
 * Normalize transcript text to canonical entity spellings.
 * Case-insensitive, word-boundary aware.
 *
 * @param text Raw transcript from STT
 * @returns Normalized text with canonical entity names
 */
export function normalizeTranscript(text: string): string {
  if (!text) return text;

  let normalized = text;
  for (const [canonical, pattern] of ENTITY_MAP) {
    normalized = normalized.replace(pattern, canonical);
  }

  return normalized;
}
