/**
 * Session Label Helpers
 *
 * Query DB for latest "real" session label, filtering out test/chat sessions.
 */

import { getDbForCampaign } from "../db.js";
import { getDefaultCampaignSlug } from "../campaign/defaultCampaign.js";
import { log } from "../utils/logger.js";

const labelsLog = log.withScope("session-labels");

/**
 * Get the most recent real session label from DB
 *
 * Filters:
 * - Only sessions with label that is NOT NULL and NOT empty (after trim)
 * - Includes only canonical sessions (kind='canon')
 * - Excludes lab-mode sessions (mode_at_start='lab')
 * - Only considers "live" sessions (skips ingest-media for now, can config if needed)
 *
 * @returns session label (trimmed) or null if none found
 */
export function getLatestRealSessionLabel(): string | null {
  const db = getDbForCampaign(getDefaultCampaignSlug());

  const row = db
    .prepare(
      `SELECT label FROM sessions
       WHERE source = 'live'
         AND label IS NOT NULL
         AND TRIM(label) != ''
         AND kind = 'canon'
         AND mode_at_start <> 'lab'
       ORDER BY created_at_ms DESC
       LIMIT 1`
    )
    .get() as { label: string | null } | undefined;

  if (!row || !row.label) {
    labelsLog.debug("No real session label found in DB");
    return null;
  }

  const trimmed = row.label.trim();
  labelsLog.debug(`Found latest real session label: "${trimmed}"`);
  return trimmed;
}

/**
 * Generate the next session label by incrementing the episode number
 *
 * Examples: "C2E19" → "C2E20", "C2E1" → "C2E2"
 * If no label found in DB, defaults to "C2E1"
 *
 * @returns session label for next episode (e.g., "C2E20")
 */
export function getNextSessionLabel(): string {
  const latest = getLatestRealSessionLabel();

  if (!latest) {
    labelsLog.debug("No prior session found, defaulting to C2E1");
    return "C2E1";
  }

  // Extract the episode number (assumes format like "C2E19", "C2E1", etc.)
  // Find the last "E" and extract the number after it
  const lastEIndex = latest.toUpperCase().lastIndexOf("E");

  if (lastEIndex === -1) {
    labelsLog.warn(`Could not parse episode number from label "${latest}", defaulting to C2E1`);
    return "C2E1";
  }

  const prefix = latest.substring(0, lastEIndex + 1); // e.g., "C2E"
  const numberStr = latest.substring(lastEIndex + 1); // e.g., "19"
  const currentNumber = parseInt(numberStr, 10);

  if (isNaN(currentNumber)) {
    labelsLog.warn(`Could not parse episode number from label "${latest}", defaulting to C2E1`);
    return "C2E1";
  }

  const nextNumber = currentNumber + 1;
  const nextLabel = `${prefix}${nextNumber}`;

  labelsLog.debug(`Auto-incremented label: "${latest}" → "${nextLabel}"`);
  return nextLabel;
}
