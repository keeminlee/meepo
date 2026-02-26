/**
 * Default campaign slug used when no campaign is specified (no guild context, no --campaign flag).
 * Env: DEFAULT_CAMPAIGN_SLUG (e.g. "faeterra-main" or "default").
 *
 * Resolution order for campaign-scoped features:
 * 1. Explicit (e.g. --campaign faeterra-main)
 * 2. From guild (guild_config.campaign_slug or slugify(guildName))
 * 3. getDefaultCampaignSlug() — always use this when 1 and 2 are not available.
 */

import { getEnv } from "../config/rawEnv.js";

const DEFAULT_CAMPAIGN_SLUG_ENV = "DEFAULT_CAMPAIGN_SLUG";
const FALLBACK_SLUG = "default";

/**
 * Campaign slug to use when none is resolved from guild or CLI.
 * Set DEFAULT_CAMPAIGN_SLUG in .env to match your primary campaign (e.g. faeterra-main).
 */
export function getDefaultCampaignSlug(): string {
  const fromEnv = getEnv(DEFAULT_CAMPAIGN_SLUG_ENV);
  if (fromEnv != null && fromEnv.trim() !== "") {
    return fromEnv.trim();
  }
  return FALLBACK_SLUG;
}
