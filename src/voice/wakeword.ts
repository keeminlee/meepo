/**
 * Voice Wake-Word Detection (Task 4.6)
 *
 * Detects if a voice transcript is addressed to Meepo.
 * Simple, robust rules: checks for "meepo" prefix, "hey meepo", "meepo:" or "meepo,"
 * Optional: also recognizes current persona displayName.
 */

import { getPersona } from "../personas/index.js";

/**
 * Check if a voice transcript is addressed to Meepo.
 *
 * Rules:
 * - Starts with "meepo " (prefix)
 * - Contains "hey meepo"
 * - Contains "meepo:" or "meepo,"
 * - Optional: contains persona displayName (if formId provided)
 *
 * All checks are case-insensitive and trimmed.
 *
 * @param text Transcript text from STT
 * @param formId Optional persona form ID to check displayName
 * @returns true if addressed to Meepo (or current persona)
 */
export function isAddressedToMeepo(text: string, formId?: string): boolean {
  const normalized = text.trim().toLowerCase();

  // Check for "meepo" triggers
  if (normalized.startsWith("meepo ")) return true;
  if (normalized.includes(" hey meepo")) return true;
  if (normalized.includes("hey meepo ")) return true;
  if (normalized.includes("meepo:")) return true;
  if (normalized.includes("meepo,")) return true;

  // Check for persona displayName if provided
  if (formId) {
    const persona = getPersona(formId);
    if (persona) {
      const displayNameLower = persona.displayName.toLowerCase();
      if (displayNameLower && normalized.includes(displayNameLower)) {
        return true;
      }
    }
  }

  return false;
}
