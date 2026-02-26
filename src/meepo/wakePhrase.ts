/**
 * Tier S/A: Wake phrase and persona-name detection.
 * Used for LISTENING vs LATCHED and for Tier S (direct) vs Tier A (mention).
 */

import { getPersona } from "../personas/index.js";
import { cfg } from "../config/env.js";

/** Display name used in "name in line" checks (e.g. "Meepo", "REI"). */
export function getPersonaDisplayName(personaId: string): string {
  const persona = getPersona(personaId);
  return persona.displayName;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getNameVariants(personaId: string): string[] {
  const display = getPersonaDisplayName(personaId).toLowerCase().trim();
  const set = new Set<string>();
  if (display) set.add(display);
  // Keep "meepo" as universal fallback wake-name regardless of active persona.
  set.add("meepo");
  return Array.from(set);
}

function textHasWholeWord(textLower: string, word: string): boolean {
  const re = new RegExp(`\\b${escapeRe(word)}\\b`, "i");
  return re.test(textLower);
}

function hasGreetingToName(textLower: string, name: string): boolean {
  const re = new RegExp(`\\b(hey|hello|hi|yo|sup|um|umm)\\b\\s*[,.!?-]*\\s*${escapeRe(name)}\\b`, "i");
  return re.test(textLower);
}

/**
 * True if content contains the current persona's name (case-insensitive).
 * Used for: LISTENING gate ("only respond when name in line") and Tier A detection.
 */
export function containsPersonaName(content: string, personaId: string): boolean {
  const lower = (content ?? "").trim().toLowerCase();
  if (!lower) return false;
  for (const name of getNameVariants(personaId)) {
    if (textHasWholeWord(lower, name)) return true;
  }
  return false;
}

/** Strip trailing punctuation so "Meepo," matches "meepo". */
function wordNorm(w: string): string {
  return w.replace(/[,.:]+$/, "");
}

function firstWordNorm(text: string): string {
  const w = (text ?? "").trim().toLowerCase().split(/\s+/)[0] ?? "";
  return wordNorm(w);
}

/**
 * True when the line should SET the latch: (1) first word is persona name, or (2) "hey meepo" / "hey <name>",
 * or (3) persona name in first three words, or (4) utterance ≤5 words and contains persona name.
 */
export function isLatchAnchor(content: string, personaId: string): boolean {
  const raw = (content ?? "").trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  const names = getNameVariants(personaId);
  if (names.length === 0) return false;
  const words = lower.split(/\s+/).map(w => wordNorm(w));
  const first = words[0] ?? "";

  if (names.some((n) => first === n)) return true;
  for (const name of names) {
    const heyName = new RegExp("hey\\s*,?\\s*" + escapeRe(name), "i");
    if (heyName.test(lower)) return true;
  }

  const firstThree = words.slice(0, 3);
  if (firstThree.some((w) => names.includes(w))) return true;

  if (words.length <= 5 && names.some((n) => textHasWholeWord(lower, n))) return true;

  return false;
}

/**
 * True if content is a direct address (wake phrase): @mention, prefix, or "hey Meepo", "Meepo:", "Meepo," etc.
 * Used for reply gating; use isLatchAnchor for when to set latch.
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
  const prefix = (opts.prefix ?? cfg.discord.botPrefix).trim().toLowerCase();
  if (prefix && lower.startsWith(prefix)) return true;

  const names = getNameVariants(personaId);
  if (names.length === 0) return false;
  for (const name of names) {
    if (lower.startsWith(name + " ")) return true;
    if (lower.includes(" " + name + " ") || lower.includes(" " + name + ",") || lower.includes(" " + name + ":")) return true;
    if (lower.startsWith("hey " + name) || lower.includes(" hey " + name + " ") || lower.endsWith(" hey " + name)) return true;
    if (lower.includes(name + ":") || lower.includes(name + ",")) return true;
    if (hasGreetingToName(lower, name)) return true;
    if (textHasWholeWord(lower, name) && /[?!]$/.test(lower)) return true;
  }

  return false;
}
