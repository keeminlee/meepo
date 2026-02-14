/**
 * Shared transcript builder for session ledger
 * 
 * Consolidates ledger querying logic used by both Meecap and Events tools.
 * Handles narrative_weight filtering upstream, always uses normalized content.
 */

import { getDb } from "../db.js";

export interface TranscriptEntry {
  line_index: number;
  author_name: string;
  content: string;       // normalized content (fallback to raw if N/A)
  timestamp_ms: number;
}

/**
 * Load session transcript from ledger with consistent filtering.
 * 
 * @param sessionId - Session UUID
 * @param primaryOnly - If true, filters to narrative_weight='primary' only. Default: true
 * @returns Array of transcript entries with stable line indices
 */
export function buildTranscript(
  sessionId: string,
  primaryOnly: boolean = true
): TranscriptEntry[] {
  const db = getDb();

  const narrativeWeightFilter = primaryOnly ? "AND narrative_weight = ?" : "";
  const params = primaryOnly ? [sessionId, "primary"] : [sessionId];

  const rows = db
    .prepare(
      `SELECT author_name, content, content_norm, timestamp_ms
       FROM ledger_entries
       WHERE session_id = ?
         AND source IN ('text', 'voice', 'offline_ingest')
         ${narrativeWeightFilter}
       ORDER BY timestamp_ms ASC, id ASC`
    )
    .all(...params) as Array<{
      author_name: string;
      content: string;
      content_norm: string | null;
      timestamp_ms: number;
    }>;

  if (rows.length === 0) {
    throw new Error(
      `No transcript entries found for session ${sessionId}` +
        (primaryOnly ? " (filtered to primary narrative_weight)" : "")
    );
  }

  return rows.map((row, idx) => ({
    line_index: idx,
    author_name: row.author_name,
    content: row.content_norm ?? row.content, // Always prefer normalized
    timestamp_ms: row.timestamp_ms,
  }));
}
