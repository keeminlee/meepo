/**
 * Guild-level persona state. form_id is cosmetic only; persona_id governs prompt + memory + guardrails.
 */

import { getDbForCampaign } from "../db.js";
import { resolveCampaignSlug } from "../campaign/guildConfig.js";
import { getActiveSessionId } from "../sessions/sessionRuntime.js";
import { getPersona } from "../personas/index.js";
import { log } from "../utils/logger.js";
import { cfg } from "../config/env.js";
import type { MeepoMode } from "../config/types.js";

const personaLog = log.withScope("persona-state");

const DEFAULT_PERSONA_ID = "meta_meepo";

function getPersonaDbForGuild(guildId: string) {
  const campaignSlug = resolveCampaignSlug({ guildId });
  return getDbForCampaign(campaignSlug);
}

/**
 * Get the active persona ID for a guild. Defaults to meta_meepo if unset.
 */
export function getActivePersonaId(guildId: string): string {
  const db = getPersonaDbForGuild(guildId);
  const row = db
    .prepare("SELECT active_persona_id FROM guild_runtime_state WHERE guild_id = ? LIMIT 1")
    .get(guildId) as { active_persona_id: string | null } | undefined;
  const id = row?.active_persona_id ?? null;
  if (id === null) {
    return DEFAULT_PERSONA_ID;
  }
  return id;
}

/**
 * Set the active persona ID for a guild. Ensures guild_runtime_state row exists (creates with current session if needed).
 */
export function setActivePersonaId(guildId: string, personaId: string): void {
  const db = getPersonaDbForGuild(guildId);
  const now = Date.now();
  const existing = db
    .prepare("SELECT active_session_id, active_mode FROM guild_runtime_state WHERE guild_id = ? LIMIT 1")
    .get(guildId) as { active_session_id: string | null; active_mode: MeepoMode | null } | undefined;

  if (existing) {
    db.prepare(
      "UPDATE guild_runtime_state SET active_persona_id = ?, updated_at_ms = ? WHERE guild_id = ?"
    ).run(personaId, now, guildId);
  } else {
    const sessionId = getActiveSessionId(guildId);
    const mode = cfg.mode;
    db.prepare(`
      INSERT INTO guild_runtime_state (guild_id, active_session_id, active_persona_id, active_mode, updated_at_ms)
      VALUES (?, ?, ?, ?, ?)
    `).run(guildId, sessionId, personaId, mode, now);
  }
  personaLog.debug(`Set active persona: guild=${guildId}, persona_id=${personaId}`);
}

/**
 * Resolve mindspace for a guild + persona. V0: meta:<guild_id> for meta; campaign:<guild_id>:<active_session_id> for campaign.
 * Returns null for campaign persona when there is no active session (caller should soft-refuse).
 */
export function getMindspace(guildId: string, personaId: string): string | null {
  const persona = getPersona(personaId);
  if (persona.scope === "meta") {
    return `meta:${guildId}`;
  }
  const sessionId = getActiveSessionId(guildId);
  if (!sessionId) {
    return null;
  }
  return `campaign:${guildId}:${sessionId}`;
}
