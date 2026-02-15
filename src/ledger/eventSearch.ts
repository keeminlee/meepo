import { getDb } from "../db.js";

/**
 * EventRow: Minimal event search result for searchEventsByTitle
 */
export interface EventRow {
  event_id: string;
  session_id: string;
  title: string;
  start_line?: number | null;
  end_line?: number | null;
  // Optionally add evidence pointers if schema expands
}

/**
 * Search events by title (case-insensitive, SQL LIKE)
 * @param term Search term (case-insensitive, substring match)
 * @returns Array of EventRow
 */
export function searchEventsByTitle(term: string): EventRow[] {
  const db = getDb();
  // Use COLLATE NOCASE for case-insensitive LIKE
  const rows = db.prepare(
    `SELECT id as event_id, session_id, description as title, start_index as start_line, end_index as end_line
     FROM events
     WHERE description LIKE ? COLLATE NOCASE
     ORDER BY timestamp_ms ASC`
  ).all(`%${term}%`) as Array<EventRow>;
  return rows;
}
