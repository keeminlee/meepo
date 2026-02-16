/**
 * Guild Runtime State: Track active session per guild
 * 
 * Minimal session management for V0:
 * - DM can start/end sessions
 * - /missions claim defaults to active session
 * - Session ID required for all mission claims (enforced at command level)
 */

import { log } from "../utils/logger.js";
import { getDb } from "../db.js";

const missionsLog = log.withScope("missions");

/**
 * Get the active session ID for a guild
 */
export function getActiveSessionId(guildId: string): string | null {
  const db = getDb();
  const row = db
    .prepare("SELECT active_session_id FROM guild_runtime_state WHERE guild_id = ? LIMIT 1")
    .get(guildId) as { active_session_id: string | null } | undefined;

  return row?.active_session_id ?? null;
}

/**
 * Set the active session ID for a guild
 */
export function setActiveSessionId(guildId: string, sessionId: string | null): void {
  const db = getDb();
  const now = Date.now();

  db.prepare(`
    INSERT OR REPLACE INTO guild_runtime_state (guild_id, active_session_id, updated_at_ms)
    VALUES (?, ?, ?)
  `).run(guildId, sessionId, now);

  if (sessionId) {
    missionsLog.debug(`Active session set: guild=${guildId}, session_id=${sessionId}`);
  } else {
    missionsLog.debug(`Active session cleared: guild=${guildId}`);
  }
}

/**
 * Clear the active session for a guild
 */
export function clearActiveSessionId(guildId: string): void {
  setActiveSessionId(guildId, null);
}
