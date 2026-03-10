import { getControlDb } from "../db.js";
import {
  normalizeCampaignSlugLookup,
  resolveGuildScopedSlugCollision,
  slugifyCampaignScopeName,
} from "./campaignScopeSlug.js";

export type ShowtimeCampaignRecord = {
  guild_id: string;
  campaign_slug: string;
  campaign_name: string;
  created_at_ms: number;
  created_by_user_id: string | null;
  dm_user_id: string | null;
};

export function listShowtimeCampaigns(guildId: string): ShowtimeCampaignRecord[] {
  const db = getControlDb();
  return db
    .prepare(
      `SELECT guild_id, campaign_slug, campaign_name, created_at_ms, created_by_user_id, dm_user_id
       FROM guild_campaigns
       WHERE guild_id = ?
       ORDER BY created_at_ms ASC, campaign_slug ASC`
    )
    .all(guildId) as ShowtimeCampaignRecord[];
}

export function getShowtimeCampaignBySlug(guildId: string, slug: string): ShowtimeCampaignRecord | null {
  const normalized = normalizeCampaignSlugLookup(slug);
  if (!normalized) return null;

  const records = listShowtimeCampaigns(guildId);
  const found = records.find((record) => normalizeCampaignSlugLookup(record.campaign_slug) === normalized);
  return found ?? null;
}

export function createShowtimeCampaign(args: {
  guildId: string;
  campaignName: string;
  createdByUserId?: string | null;
  dmUserId?: string | null;
}): ShowtimeCampaignRecord {
  const campaignName = args.campaignName.trim();
  if (!campaignName) {
    throw new Error("campaignName is required");
  }

  const db = getControlDb();
  const existing = listShowtimeCampaigns(args.guildId);
  const baseSlug = slugifyCampaignScopeName(campaignName);
  const slug = resolveGuildScopedSlugCollision(
    baseSlug,
    existing.map((record) => record.campaign_slug)
  );
  const createdAtMs = Date.now();

  const dmUserId = args.dmUserId?.trim() || args.createdByUserId?.trim() || null;

  db.prepare(
    `INSERT INTO guild_campaigns (guild_id, campaign_slug, campaign_name, created_at_ms, created_by_user_id, dm_user_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(args.guildId, slug, campaignName, createdAtMs, args.createdByUserId ?? null, dmUserId);

  return {
    guild_id: args.guildId,
    campaign_slug: slug,
    campaign_name: campaignName,
    created_at_ms: createdAtMs,
    created_by_user_id: args.createdByUserId ?? null,
    dm_user_id: dmUserId,
  };
}
