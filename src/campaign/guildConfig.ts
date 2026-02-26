/**
 * Guild-level campaign config: campaign_slug, default_persona_id, dm_role_id.
 * New guilds get a row on first resolution; campaign_slug defaults to slugify(guildName).
 */

import { getControlDb } from "../db.js";
import { slugify } from "../utils/slugify.js";
import { getDefaultCampaignSlug } from "./defaultCampaign.js";
import { log } from "../utils/logger.js";

const campaignLog = log.withScope("campaign");

export type GuildConfigRow = {
  guild_id: string;
  campaign_slug: string;
  dm_role_id: string | null;
  default_persona_id: string | null;
};

/**
 * Get guild config if it exists.
 */
export function getGuildConfig(guildId: string): GuildConfigRow | null {
  const db = getControlDb();
  const row = db
    .prepare(
      "SELECT guild_id, campaign_slug, dm_role_id, default_persona_id FROM guild_config WHERE guild_id = ? LIMIT 1"
    )
    .get(guildId) as GuildConfigRow | undefined;
  return row ?? null;
}

/**
 * Ensure a config row exists for the guild. If not, create one with campaign_slug from guildName (or default).
 * Returns the config row (existing or newly created).
 */
export function ensureGuildConfig(guildId: string, guildName?: string | null): GuildConfigRow {
  let row = getGuildConfig(guildId);
  if (row) return row;

  const db = getControlDb();
  const slug = guildName ? slugify(guildName) : getDefaultCampaignSlug();
  db.prepare(
    `INSERT INTO guild_config (guild_id, campaign_slug, dm_role_id, default_persona_id)
     VALUES (?, ?, NULL, NULL)`
  ).run(guildId, slug);
  campaignLog.info(`Created guild_config for guild=${guildId} campaign_slug=${slug}`);
  row = getGuildConfig(guildId)!;
  return row;
}

/**
 * Resolve campaign slug for a guild. Uses guild_config if set; else derives from guildName, persists, and returns.
 * If neither guildId nor guildName available, returns default (use resolveCampaignSlug only when you have at least one).
 */
export function resolveCampaignSlug(opts: {
  guildId?: string | null;
  guildName?: string | null;
}): string {
  const { guildId, guildName } = opts;

  if (guildId) {
    const config = getGuildConfig(guildId);
    if (config?.campaign_slug) {
      campaignLog.debug(`Campaign slug from guild_config: ${config.campaign_slug}`);
      return config.campaign_slug;
    }
    ensureGuildConfig(guildId, guildName ?? null);
    const after = getGuildConfig(guildId)!;
    campaignLog.info(`Campaign: ${after.campaign_slug} (resolved for guild=${guildId})`);
    return after.campaign_slug;
  }

  const defaultSlug = getDefaultCampaignSlug();
  campaignLog.info(`Campaign: ${defaultSlug} (no guild, using default)`);
  return defaultSlug;
}

/**
 * Set campaign slug for a guild (override). Creates guild_config if needed.
 */
export function setGuildCampaignSlug(guildId: string, campaignSlug: string): void {
  const db = getControlDb();
  ensureGuildConfig(guildId, null);
  db.prepare("UPDATE guild_config SET campaign_slug = ? WHERE guild_id = ?").run(campaignSlug, guildId);
  campaignLog.info(`Set campaign_slug=${campaignSlug} for guild=${guildId}`);
}

/**
 * Set default persona for a guild (e.g. rei for Panda server). Creates guild_config if needed.
 */
export function setGuildDefaultPersonaId(guildId: string, personaId: string | null): void {
  const db = getControlDb();
  ensureGuildConfig(guildId, null);
  db.prepare("UPDATE guild_config SET default_persona_id = ? WHERE guild_id = ?").run(personaId, guildId);
  campaignLog.info(`Set default_persona_id=${personaId ?? "null"} for guild=${guildId}`);
}

/**
 * Get default persona for a guild from guild_config. Returns null if not set (caller uses app default).
 */
export function getGuildDefaultPersonaId(guildId: string): string | null {
  const config = getGuildConfig(guildId);
  return config?.default_persona_id ?? null;
}
