/**
 * Voice Wake-Word Detection (Task 4.6)
 *
 * Detects if a voice transcript is addressed to Meepo.
 * Simple, robust rules: checks for "meepo" prefix, "hey meepo", "meepo:" or "meepo,"
 * Optional: also recognizes current persona displayName.
 */

import { getPersona } from "../personas/index.js";

/** Strip trailing punctuation (comma, period, colon) so "meepo," matches "meepo". */
function wordNorm(w: string): string {
  return w.replace(/[,.:]+$/, "");
}

/** First word only (for backward compat). */
function firstWordNorm(text: string): string {
  const w = text.trim().toLowerCase().split(/\s+/)[0] ?? "";
  return wordNorm(w);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getNameVariants(formOrPersonaId?: string): string[] {
  const set = new Set<string>(["meepo"]);
  if (formOrPersonaId) {
    const persona = getPersona(formOrPersonaId);
    if (persona?.displayName) set.add(persona.displayName.toLowerCase());
  }
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
 * When to SET the latch: (1) first word is Meepo/persona, or (2) "hey meepo" / "hey <name>",
 * or (3) Meepo/persona appears in the first three words, or (4) utterance is ≤5 words and contains Meepo/persona.
 */
export function isLatchAnchor(text: string, formId?: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  const words = normalized.split(/\s+/).map(w => wordNorm(w));
  const first = words[0] ?? "";
  const names = getNameVariants(formId);

  if (names.some((n) => first === n)) return true;
  for (const n of names) {
    const heyName = new RegExp("hey\\s*,?\\s*" + escapeRe(n), "i");
    if (heyName.test(normalized)) return true;
  }

  const firstThree = words.slice(0, 3);
  if (firstThree.some((w) => names.includes(w))) return true;

  if (words.length <= 5 && names.some((n) => textHasWholeWord(normalized, n))) return true;

  return false;
}

/**
 * Anchor: direct address (wake phrase) — used for reply gating (voice S).
 * Broader than isLatchAnchor: "meepo " at start, "hey meepo", "meepo:", "meepo,", or persona displayName anywhere.
 */
export function isAddressedToMeepo(text: string, formId?: string): boolean {
  const normalized = text.trim().toLowerCase();
  const names = getNameVariants(formId);

  for (const n of names) {
    if (normalized.startsWith(n + " ")) return true;
    if (normalized.includes(" hey " + n)) return true;
    if (normalized.includes("hey " + n + " ")) return true;
    if (normalized.includes(n + ":")) return true;
    if (normalized.includes(n + ",")) return true;
    if (hasGreetingToName(normalized, n)) return true;
    if (textHasWholeWord(normalized, n) && /[?!]$/.test(normalized)) return true;
  }

  return false;
}

/**
 * Has Meepo: contains "meepo" or persona name anywhere (mention-like).
 * Used for: if anchor → voice S; else if hasMeepo + latched → voice S; else if hasMeepo → text A.
 */
export function hasMeepoInLine(text: string, formId?: string): boolean {
  const normalized = text.trim().toLowerCase();
  const names = getNameVariants(formId);
  if (names.some((n) => textHasWholeWord(normalized, n))) return true;
  return false;
}
