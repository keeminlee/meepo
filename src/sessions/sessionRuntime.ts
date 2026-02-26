/**
 * Guild Runtime State: Track active session per guild
 * 
 * Minimal session management for V0:
 * - DM can start/end sessions
 * - /missions claim defaults to active session
 * - Session ID required for all mission claims (enforced at command level)
 */

import { log } from "../utils/logger.js";
import { getDbForCampaign } from "../db.js";
import { resolveCampaignSlug } from "../campaign/guildConfig.js";
import { cfg } from "../config/env.js";
import type { MeepoMode } from "../config/types.js";
import type { SessionKind } from "./sessions.js";

const missionsLog = log.withScope("missions");

function getRuntimeDbForGuild(guildId: string) {
  const campaignSlug = resolveCampaignSlug({ guildId });
  return getDbForCampaign(campaignSlug);
}

export function sessionKindForMode(mode: MeepoMode): SessionKind {
  if (mode === "ambient") return "chat";
  return "canon";
}

export function getGuildMode(guildId: string): MeepoMode {
  const db = getRuntimeDbForGuild(guildId);
  const row = db
    .prepare("SELECT active_mode FROM guild_runtime_state WHERE guild_id = ? LIMIT 1")
    .get(guildId) as { active_mode: MeepoMode | null } | undefined;

  return row?.active_mode ?? cfg.mode;
}

export function setGuildMode(guildId: string, mode: MeepoMode): void {
  const db = getRuntimeDbForGuild(guildId);
  const now = Date.now();
  const row = db
    .prepare("SELECT active_session_id, active_persona_id FROM guild_runtime_state WHERE guild_id = ? LIMIT 1")
    .get(guildId) as { active_session_id: string | null; active_persona_id: string | null } | undefined;

  db.prepare(`
    INSERT OR REPLACE INTO guild_runtime_state (guild_id, active_session_id, active_persona_id, active_mode, updated_at_ms)
    VALUES (?, ?, ?, ?, ?)
  `).run(guildId, row?.active_session_id ?? null, row?.active_persona_id ?? "meta_meepo", mode, now);

  missionsLog.info(`Guild mode set: guild=${guildId}, mode=${mode}`);
}

/**
 * Get the active session ID for a guild
 */
export function getActiveSessionId(guildId: string): string | null {
  const db = getRuntimeDbForGuild(guildId);
  const row = db
    .prepare("SELECT active_session_id FROM guild_runtime_state WHERE guild_id = ? LIMIT 1")
    .get(guildId) as { active_session_id: string | null } | undefined;

  return row?.active_session_id ?? null;
}

/**
 * Set the active session ID for a guild. Preserves active_persona_id.
 */
export function setActiveSessionId(guildId: string, sessionId: string | null): void {
  const db = getRuntimeDbForGuild(guildId);
  const now = Date.now();
  const row = db
    .prepare("SELECT active_persona_id, active_mode FROM guild_runtime_state WHERE guild_id = ? LIMIT 1")
    .get(guildId) as { active_persona_id: string | null; active_mode: MeepoMode | null } | undefined;
  const personaId = row?.active_persona_id ?? "meta_meepo";
  const activeMode = row?.active_mode ?? cfg.mode;

  db.prepare(`
    INSERT OR REPLACE INTO guild_runtime_state (guild_id, active_session_id, active_persona_id, active_mode, updated_at_ms)
    VALUES (?, ?, ?, ?, ?)
  `).run(guildId, sessionId, personaId, activeMode, now);

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
