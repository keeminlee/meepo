import { getDbForCampaign } from "../db.js";
import { resolveCampaignSlug } from "../campaign/guildConfig.js";
import { loadRegistry } from "../registry/loadRegistry.js";

/**
 * Speaker Name Sanitizer
 * 
 * Sanitizes Discord display names to prevent OOC name leakage into NPC context.
 * 
 * Priority order:
 * 1. speaker_masks table (explicit DM configuration)
 * 2. Registry character mapping (PC/NPC canonical names)
 * 3. Fallback to "Party Member" (prevents Discord username leakage)
 * 
 * @param guildId Guild ID for speaker mask lookup
 * @param authorId Discord user ID
 * @param authorName Discord display name (fallback)
 * @returns Diegetic name safe for NPC context
 */
export function getSanitizedSpeakerName(
  guildId: string,
  authorId: string,
  authorName: string
): string {
  const campaignSlug = resolveCampaignSlug({ guildId });
  const db = getDbForCampaign(campaignSlug);

  // 1. Check speaker_masks table (highest priority)
  const maskRow = db
    .prepare("SELECT speaker_mask FROM speaker_masks WHERE guild_id = ? AND discord_user_id = ?")
    .get(guildId, authorId) as { speaker_mask: string } | undefined;

  if (maskRow) {
    return maskRow.speaker_mask;
  }

  // 2. Check registry for character mapping
  // (Future: Add discord_user_id field to registry and match here)
  // For now, skip this step

  // 3. Fallback to generic "Party Member"
  return "Party Member";
}
