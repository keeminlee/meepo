/**
 * Tier S/A: Wake phrase and persona-name detection.
 * Used for LISTENING vs LATCHED and for Tier S (direct) vs Tier A (mention).
 */

import { getPersona } from "../personas/index.js";

/** Display name used in "name in line" checks (e.g. "Meepo", "REI"). */
export function getPersonaDisplayName(personaId: string): string {
  const persona = getPersona(personaId);
  return persona.displayName;
}

/**
 * True if content contains the current persona's name (case-insensitive).
 * Used for: LISTENING gate ("only respond when name in line") and Tier A detection.
 */
export function containsPersonaName(content: string, personaId: string): boolean {
  const name = getPersonaDisplayName(personaId);
  return (content ?? "").trim().toLowerCase().includes(name.toLowerCase());
}

/**
 * True if content is a direct address (wake phrase): @mention, prefix, or "hey Meepo", "Meepo:", "Meepo," etc.
 * Used to set latch and for Tier S trigger.
 */
export function isWakePhrase(
  content: string,
  personaId: string,
  opts: { mentioned?: boolean; prefix?: string } = {}
): boolean {
  if (opts.mentioned) return true;

  const raw = (content ?? "").trim();
  if (!raw) return false;

  const lower = raw.toLowerCase();
  const prefix = (opts.prefix ?? process.env.BOT_PREFIX ?? "meepo:").trim().toLowerCase();
  if (prefix && lower.startsWith(prefix)) return true;

  const name = getPersonaDisplayName(personaId).toLowerCase();
  if (!name) return false;

  // "meepo " at start, "hey meepo", "meepo:", "meepo,"
  if (lower.startsWith(name + " ")) return true;
  if (lower.includes(" " + name + " ") || lower.includes(" " + name + ",") || lower.includes(" " + name + ":")) return true;
  if (lower.startsWith("hey " + name) || lower.includes(" hey " + name + " ") || lower.endsWith(" hey " + name)) return true;
  if (lower.includes(name + ":") || lower.includes(name + ",")) return true;

  return false;
}
