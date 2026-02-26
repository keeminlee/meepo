import { getEnv } from "../config/rawEnv.js";

/**
 * scaffoldSpeaker.ts
 *
 * Utilities for determining whether a transcript line is spoken by the DM.
 *
 * Default DM name is "DM" (case-insensitive).
 * Extended via DM_SPEAKER env var (comma-separated list) or caller-supplied options.
 */

/**
 * scaffoldSpeaker.ts
 *
 * Utilities for determining whether a transcript line is spoken by the DM.
 *
 * Scans the transcript's actual speaker names and identifies the DM speaker
 * as the one that contains "DM" (case-insensitive). Falls back to caller-supplied
 * options or env var if no match found.
 */

/**
 * Detect the DM speaker name from a list of actual speaker names.
 * Returns the speaker name that contains "DM", or null if none found.
 */
export function detectDmSpeaker(speakerNames: string[]): string | null {
  const dmMatch = speakerNames.find((name) => /\bdm\b/i.test(name));
  return dmMatch ?? null;
}

/**
 * Build the effective set of DM names.
 *
 * Priority:
 * 1. Detected from transcript (speaker name containing "DM")
 * 2. DM_SPEAKER env var (comma-separated)
 * 3. Caller-supplied dmNames
 *
 * If all are empty, falls back to ["dm"].
 */
export function buildDmNameSet(detectedDm?: string | null, extra?: string[]): Set<string> {
  const set = new Set<string>();

  // Priority 1: detected from transcript
  if (detectedDm) {
    set.add(detectedDm.toLowerCase().trim());
    return set;
  }

  // Priority 2: DM_SPEAKER env var
  const envNames = getEnv("DM_SPEAKER", "") ?? "";
  if (envNames.trim()) {
    for (const n of envNames.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)) {
      set.add(n);
    }
    if (set.size > 0) return set;
  }

  // Priority 3: caller-supplied
  for (const n of extra ?? []) {
    set.add(n.toLowerCase().trim());
  }
  if (set.size > 0) return set;

  // Fallback
  return new Set(["dm"]);
}

/**
 * Returns true if the given author_name is considered a DM line.
 *
 * @param authorName - The author_name column from bronze_transcript
 * @param dmNames    - Effective set returned by buildDmNameSet()
 */
export function isDmSpeaker(authorName: string, dmNames: Set<string>): boolean {
  return dmNames.has(authorName.toLowerCase().trim());
}
