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

type RuntimeStateRow = {
  active_session_id: string | null;
  active_persona_id: string | null;
  active_mode: MeepoMode | null;
  diegetic_persona_id: string | null;
};

function getRuntimeDbForGuild(guildId: string) {
  const campaignSlug = resolveCampaignSlug({ guildId });
  return getDbForCampaign(campaignSlug);
}

export function sessionKindForMode(mode: MeepoMode): SessionKind {
  if (mode === "ambient") return "noncanon";
  return "canon";
}

function getRuntimeState(guildId: string): RuntimeStateRow | null {
  const db = getRuntimeDbForGuild(guildId);
  const row = db
    .prepare(
      "SELECT active_session_id, active_persona_id, active_mode, diegetic_persona_id FROM guild_runtime_state WHERE guild_id = ? LIMIT 1"
    )
    .get(guildId) as RuntimeStateRow | undefined;

  return row ?? null;
}

function ensureRuntimeState(guildId: string): RuntimeStateRow {
  const existing = getRuntimeState(guildId);
  if (existing) return existing;

  const db = getRuntimeDbForGuild(guildId);
  const now = Date.now();
  db.prepare(
    `
    INSERT INTO guild_runtime_state (guild_id, active_session_id, active_persona_id, active_mode, diegetic_persona_id, updated_at_ms)
    VALUES (?, NULL, ?, NULL, NULL, ?)
  `
  ).run(guildId, "meta_meepo", now);

  return getRuntimeState(guildId)!;
}

function isGuildAwake(guildId: string): boolean {
  const db = getRuntimeDbForGuild(guildId);
  const row = db
    .prepare("SELECT 1 AS awake FROM npc_instances WHERE guild_id = ? AND is_active = 1 LIMIT 1")
    .get(guildId) as { awake: number } | undefined;
  return Boolean(row?.awake);
}

export function getGuildModeOverride(guildId: string): MeepoMode | null {
  const state = getRuntimeState(guildId);
  const override = state?.active_mode ?? null;
  if (override === "lab" || override === "dormant") {
    return override;
  }
  return null;
}

export function resolveEffectiveMode(guildId: string): MeepoMode {
  const override = getGuildModeOverride(guildId);

  if (override === "dormant") return "dormant";
  if (override === "lab") return "lab";

  const activeSessionId = getActiveSessionId(guildId);
  if (activeSessionId) return "canon";

  if (isGuildAwake(guildId)) return "ambient";

  return "dormant";
}

export function getGuildMode(guildId: string): MeepoMode {
  return resolveEffectiveMode(guildId);
}

export function setGuildMode(guildId: string, mode: MeepoMode): void {
  const db = getRuntimeDbForGuild(guildId);
  const now = Date.now();
  const state = ensureRuntimeState(guildId);

  const persistedOverride = mode === "lab" || mode === "dormant" ? mode : null;

  db.prepare(`
    UPDATE guild_runtime_state
    SET active_mode = ?, updated_at_ms = ?
    WHERE guild_id = ?
  `).run(persistedOverride, now, guildId);

  missionsLog.info(`Guild mode override set: guild=${guildId}, mode=${persistedOverride ?? "derived"}`);
}

/**
 * Get the active session ID for a guild
 */
export function getActiveSessionId(guildId: string): string | null {
  const state = getRuntimeState(guildId);
  return state?.active_session_id ?? null;
}

/**
 * Set the active session ID for a guild. Preserves active_persona_id.
 */
export function setActiveSessionId(guildId: string, sessionId: string | null): void {
  const db = getRuntimeDbForGuild(guildId);
  const now = Date.now();
  const state = ensureRuntimeState(guildId);
  const personaId = state.active_persona_id ?? "meta_meepo";
  const activeMode = state.active_mode ?? null;
  const diegeticPersonaId = state.diegetic_persona_id ?? null;

  db.prepare(`
    INSERT OR REPLACE INTO guild_runtime_state (guild_id, active_session_id, active_persona_id, active_mode, diegetic_persona_id, updated_at_ms)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(guildId, sessionId, personaId, activeMode, diegeticPersonaId, now);

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

export function getConfiguredDiegeticPersonaId(guildId: string): string | null {
  const state = getRuntimeState(guildId);
  return state?.diegetic_persona_id ?? null;
}

export function setConfiguredDiegeticPersonaId(guildId: string, personaId: string | null): void {
  const db = getRuntimeDbForGuild(guildId);
  const now = Date.now();
  ensureRuntimeState(guildId);
  db.prepare(
    "UPDATE guild_runtime_state SET diegetic_persona_id = ?, updated_at_ms = ? WHERE guild_id = ?"
  ).run(personaId, now, guildId);
}
