/**
 * officialSessions.ts
 *
 * Shared helpers for querying "official" sessions — sessions that have a
 * non-empty label that doesn't contain "test". Used by batch compile tools
 * (compile-transcripts, compile-and-export-events-batch, etc.) to determine
 * which sessions to process.
 */

import Database from "better-sqlite3";

export interface OfficialSessionRow {
  session_id: string;
  label: string;
  source: string;     // 'live' | 'ingest-media'
  created_at_ms: number;
}

/**
 * Return one row per *unique label* (latest created_at_ms wins) for all
 * official sessions.
 *
 * "Official" means:
 *   - label IS NOT NULL and label <> ''
 *   - label does not contain "test" or "chat" (case-insensitive)
 */
export function getOfficialSessionRows(db: Database.Database): OfficialSessionRow[] {
  // Fetch all candidates ordered newest-first, then deduplicate by label
  const rows = db
    .prepare(
      `SELECT session_id, label, source, created_at_ms
       FROM sessions
       WHERE label IS NOT NULL
         AND label <> ''
         AND LOWER(label) NOT LIKE '%test%'
         AND LOWER(label) NOT LIKE '%chat%'
       ORDER BY created_at_ms DESC`
    )
    .all() as OfficialSessionRow[];

  // Keep only the first (newest) entry per label
  const seen = new Set<string>();
  const deduplicated: OfficialSessionRow[] = [];
  for (const row of rows) {
    if (!seen.has(row.label)) {
      seen.add(row.label);
      deduplicated.push(row);
    }
  }

  return deduplicated;
}

/**
 * Return the unique labels of all official sessions, newest-first.
 */
export function getOfficialSessionLabels(db: Database.Database): string[] {
  return getOfficialSessionRows(db).map((r) => r.label);
}

/**
 * Look up a single official session by label (latest created_at_ms).
 * Returns null if not found or is a test session.
 */
export function getOfficialSessionByLabel(
  db: Database.Database,
  label: string
): OfficialSessionRow | null {
  const row = db
    .prepare(
      `SELECT session_id, label, source, created_at_ms
       FROM sessions
       WHERE label = ?
         AND LOWER(label) NOT LIKE '%test%'
         AND LOWER(label) NOT LIKE '%chat%'
       ORDER BY created_at_ms DESC
       LIMIT 1`
    )
    .get(label) as OfficialSessionRow | undefined;

  return row ?? null;
}
