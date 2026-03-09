import {
  setGuildCampaignSlug,
  setGuildCanonPersonaId,
  setGuildCanonPersonaMode,
  setGuildDefaultRecapStyle,
  setGuildDefaultTalkMode,
  setGuildDmRoleId,
  setGuildDmUserId,
  setGuildHomeTextChannelId,
  setGuildHomeVoiceChannelId,
  setGuildMetaCampaignSlug,
} from "../../campaign/guildConfig.js";
import type { CommitSpec } from "../../scripts/awakening/_schema.js";
import type { CommitContext } from "./commitActionRegistry.js";
import { requireStringField, resolveCommitValue } from "./commitUtils.js";

export async function handleSetGuildConfigCommit(ctx: CommitContext, commit: CommitSpec): Promise<void> {
  const key = requireStringField(commit, "key");
  const value = resolveCommitValue({ commit, inputs: ctx.inputs });

  switch (key) {
    case "campaign_slug":
      if (typeof value !== "string") throw new Error("set_guild_config.campaign_slug must be a string");
      setGuildCampaignSlug(ctx.guildId, value.trim());
      return;
    case "meta_campaign_slug":
      if (typeof value !== "string" && value !== null) {
        throw new Error("set_guild_config.meta_campaign_slug must be string|null");
      }
      setGuildMetaCampaignSlug(ctx.guildId, typeof value === "string" && value.trim().length > 0 ? value.trim() : null);
      return;
    case "home_text_channel_id":
      setGuildHomeTextChannelId(ctx.guildId, typeof value === "string" && value.trim().length > 0 ? value.trim() : null);
      return;
    case "home_voice_channel_id":
      setGuildHomeVoiceChannelId(ctx.guildId, typeof value === "string" && value.trim().length > 0 ? value.trim() : null);
      return;
    case "dm_user_id":
      setGuildDmUserId(ctx.guildId, typeof value === "string" && value.trim().length > 0 ? value.trim() : null);
      return;
    case "dm_role_id":
      setGuildDmRoleId(ctx.guildId, typeof value === "string" && value.trim().length > 0 ? value.trim() : null);
      return;
    case "default_talk_mode":
      if (value !== "hush" && value !== "talk" && value !== null) {
        throw new Error("set_guild_config.default_talk_mode must be hush|talk|null");
      }
      setGuildDefaultTalkMode(ctx.guildId, value as "hush" | "talk" | null);
      return;
    case "canon_persona_mode":
      if (value !== "diegetic" && value !== "meta" && value !== null) {
        throw new Error("set_guild_config.canon_persona_mode must be diegetic|meta|null");
      }
      setGuildCanonPersonaMode(ctx.guildId, value as "diegetic" | "meta" | null);
      return;
    case "canon_persona_id":
      setGuildCanonPersonaId(ctx.guildId, typeof value === "string" && value.trim().length > 0 ? value.trim() : null);
      return;
    case "default_recap_style":
      if (value !== "balanced" && value !== "concise" && value !== "detailed" && value !== null) {
        throw new Error("set_guild_config.default_recap_style must be balanced|concise|detailed|null");
      }
      setGuildDefaultRecapStyle(ctx.guildId, value as "balanced" | "concise" | "detailed" | null);
      return;
    default:
      throw new Error(`Unsupported set_guild_config key: ${key}`);
  }
}
