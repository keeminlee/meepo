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
  dm_user_id: string | null;
  dm_role_id: string | null;
  default_persona_id: string | null;
  setup_version: number | null;
  home_text_channel_id: string | null;
  home_voice_channel_id: string | null;
  canon_persona_mode: "diegetic" | "meta" | null;
  canon_persona_id: string | null;
  default_recap_style: "balanced" | "concise" | "detailed" | null;
};

const envHomeVoiceIgnoredGuilds = new Set<string>();

/**
 * Get guild config if it exists.
 */
export function getGuildConfig(guildId: string): GuildConfigRow | null {
  const db = getControlDb();
  const row = db
    .prepare(
      "SELECT guild_id, campaign_slug, dm_user_id, dm_role_id, default_persona_id, setup_version, home_text_channel_id, home_voice_channel_id, canon_persona_mode, canon_persona_id, default_recap_style FROM guild_config WHERE guild_id = ? LIMIT 1"
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
    `INSERT INTO guild_config (
      guild_id,
      campaign_slug,
      dm_user_id,
      dm_role_id,
      default_persona_id,
      setup_version,
      home_text_channel_id,
      home_voice_channel_id,
      canon_persona_mode,
      canon_persona_id,
      default_recap_style
    )
      VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`
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

export function getGuildDmUserId(guildId: string): string | null {
  const config = getGuildConfig(guildId);
  return config?.dm_user_id ?? null;
}

export function setGuildDmUserId(guildId: string, dmUserId: string | null): void {
  const db = getControlDb();
  ensureGuildConfig(guildId, null);
  db.prepare("UPDATE guild_config SET dm_user_id = ? WHERE guild_id = ?").run(dmUserId, guildId);
  campaignLog.info(`Set dm_user_id=${dmUserId ?? "null"} for guild=${guildId}`);
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

export function getGuildHomeTextChannelId(guildId: string): string | null {
  const config = getGuildConfig(guildId);
  return config?.home_text_channel_id ?? null;
}

export function setGuildHomeTextChannelId(guildId: string, channelId: string | null): void {
  const db = getControlDb();
  ensureGuildConfig(guildId, null);
  db.prepare("UPDATE guild_config SET home_text_channel_id = ? WHERE guild_id = ?").run(channelId, guildId);
  campaignLog.info(`Set home_text_channel_id=${channelId ?? "null"} for guild=${guildId}`);
}

export function getGuildHomeVoiceChannelId(guildId: string): string | null {
  const config = getGuildConfig(guildId);
  return config?.home_voice_channel_id ?? null;
}

export function setGuildHomeVoiceChannelId(guildId: string, channelId: string | null): void {
  const db = getControlDb();
  ensureGuildConfig(guildId, null);
  db.prepare("UPDATE guild_config SET home_voice_channel_id = ? WHERE guild_id = ?").run(channelId, guildId);
  campaignLog.info(`Set home_voice_channel_id=${channelId ?? "null"} for guild=${guildId}`);
}

export function resolveGuildHomeVoiceChannelId(guildId: string, envHomeVoiceChannelId?: string | null): string | null {
  const persisted = getGuildHomeVoiceChannelId(guildId);
  if (persisted) {
    if (envHomeVoiceChannelId && !envHomeVoiceIgnoredGuilds.has(guildId)) {
      envHomeVoiceIgnoredGuilds.add(guildId);
      campaignLog.info(
        `Ignoring MEEPO_HOME_VOICE_CHANNEL_ID for guild=${guildId}; persisted home_voice_channel_id takes precedence.`
      );
    }
    return persisted;
  }

  if (envHomeVoiceChannelId) {
    setGuildHomeVoiceChannelId(guildId, envHomeVoiceChannelId);
    campaignLog.info(
      `Bootstrapped home_voice_channel_id from env MEEPO_HOME_VOICE_CHANNEL_ID for guild=${guildId}`
    );
    return envHomeVoiceChannelId;
  }

  return null;
}

export function getGuildSetupVersion(guildId: string): number | null {
  const config = getGuildConfig(guildId);
  return config?.setup_version ?? null;
}

export function setGuildSetupVersion(guildId: string, version: number | null): void {
  const db = getControlDb();
  ensureGuildConfig(guildId, null);
  db.prepare("UPDATE guild_config SET setup_version = ? WHERE guild_id = ?").run(version, guildId);
}

export function getGuildCanonPersonaMode(guildId: string): "diegetic" | "meta" | null {
  const config = getGuildConfig(guildId);
  const mode = config?.canon_persona_mode ?? null;
  return mode === "diegetic" || mode === "meta" ? mode : null;
}

export function setGuildCanonPersonaMode(guildId: string, mode: "diegetic" | "meta" | null): void {
  const db = getControlDb();
  ensureGuildConfig(guildId, null);
  db.prepare("UPDATE guild_config SET canon_persona_mode = ? WHERE guild_id = ?").run(mode, guildId);
}

export function getGuildCanonPersonaId(guildId: string): string | null {
  const config = getGuildConfig(guildId);
  return config?.canon_persona_id ?? null;
}

export function setGuildCanonPersonaId(guildId: string, personaId: string | null): void {
  const db = getControlDb();
  ensureGuildConfig(guildId, null);
  db.prepare("UPDATE guild_config SET canon_persona_id = ? WHERE guild_id = ?").run(personaId, guildId);
}

export function getGuildDefaultRecapStyle(guildId: string): "balanced" | "concise" | "detailed" | null {
  const config = getGuildConfig(guildId);
  const style = config?.default_recap_style ?? null;
  if (style === "balanced" || style === "concise" || style === "detailed") return style;
  return null;
}

export function setGuildDefaultRecapStyle(
  guildId: string,
  style: "balanced" | "concise" | "detailed" | null
): void {
  const db = getControlDb();
  ensureGuildConfig(guildId, null);
  db.prepare("UPDATE guild_config SET default_recap_style = ? WHERE guild_id = ?").run(style, guildId);
}
