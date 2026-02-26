import { getDbForCampaign } from "../db.js";
import { getDefaultCampaignSlug } from "../campaign/defaultCampaign.js";
import { resolveCampaignSlug } from "../campaign/guildConfig.js";

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
export function searchEventsByTitle(term: string, campaignSlug?: string): EventRow[] {
  const db = getDbForCampaign(campaignSlug ?? getDefaultCampaignSlug());
  // Use COLLATE NOCASE for case-insensitive LIKE
  const rows = db.prepare(
    `SELECT id as event_id, session_id, description as title, start_index as start_line, end_index as end_line
     FROM events
     WHERE description LIKE ? COLLATE NOCASE
     ORDER BY timestamp_ms ASC`
  ).all(`%${term}%`) as Array<EventRow>;
  return rows;
}

export function searchEventsByTitleScoped(opts: {
  term: string;
  guildId: string;
}): EventRow[] {
  const campaignSlug = resolveCampaignSlug({ guildId: opts.guildId });
  const db = getDbForCampaign(campaignSlug);
  const rows = db.prepare(
    `SELECT e.id as event_id, e.session_id, e.description as title, e.start_index as start_line, e.end_index as end_line
     FROM events e
     INNER JOIN sessions s ON s.session_id = e.session_id
     WHERE e.description LIKE ? COLLATE NOCASE
       AND s.guild_id = ?
     ORDER BY e.timestamp_ms ASC`
  ).all(`%${opts.term}%`, opts.guildId) as Array<EventRow>;
  return rows;
}
