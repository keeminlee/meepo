import { PermissionFlagsBits } from "discord.js";
import {
  ensureGuildConfig,
  getGuildCanonPersonaMode,
  getGuildConfig,
  getGuildDmUserId,
  getGuildHomeTextChannelId,
  getGuildHomeVoiceChannelId,
  getGuildSetupVersion,
  resolveCampaignSlug,
  setGuildCanonPersonaMode,
  setGuildDefaultRecapStyle,
  setGuildDmUserId,
  setGuildHomeTextChannelId,
  setGuildHomeVoiceChannelId,
  setGuildSetupVersion,
} from "./guildConfig.js";
import { logSystemEvent } from "../ledger/system.js";

export type SetupReport = {
  applied: string[];
  warnings: string[];
  errors: string[];
  setupVersionChanged: boolean;
  canAttemptVoice: boolean;
};

export async function ensureGuildSetup(args: {
  guildId: string;
  guildName?: string | null;
  interaction: any;
  canonicalWake?: boolean;
}): Promise<SetupReport> {
  const applied: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  ensureGuildConfig(args.guildId, args.guildName ?? null);

  const guild = args.interaction.guild;
  const channel = args.interaction.channel;
  const botMember = guild?.members?.me ?? null;
  const invocationChannelId = args.interaction.channelId as string;

  if (!getGuildHomeTextChannelId(args.guildId)) {
    setGuildHomeTextChannelId(args.guildId, invocationChannelId);
    applied.push(`Bound home text to <#${invocationChannelId}>`);
  }

  if (!getGuildHomeVoiceChannelId(args.guildId)) {
    try {
      const invoker = await guild.members.fetch(args.interaction.user.id);
      const invokerVoiceChannelId = invoker.voice.channelId ?? null;
      if (invokerVoiceChannelId) {
        setGuildHomeVoiceChannelId(args.guildId, invokerVoiceChannelId);
        applied.push(`Bound home voice to <#${invokerVoiceChannelId}>`);
      }
    } catch {
      warnings.push("Could not inspect invoker voice channel for auto-bind");
    }
  }

  const campaignSlug = resolveCampaignSlug({ guildId: args.guildId, guildName: args.guildName ?? null });
  const hasCampaignSlug = typeof campaignSlug === "string" && campaignSlug.trim().length > 0;

  if (!getGuildCanonPersonaMode(args.guildId)) {
    setGuildCanonPersonaMode(args.guildId, "meta");
    applied.push("Initialized canon persona mode to meta");
  }

  if (args.canonicalWake) {
    const existingDmUserId = getGuildDmUserId(args.guildId);
    if (!existingDmUserId) {
      const invokerId = args.interaction.user?.id as string | undefined;
      if (invokerId && invokerId.trim().length > 0) {
        setGuildDmUserId(args.guildId, invokerId);
        applied.push(`Bound canonical DM identity to <@${invokerId}>`);
        try {
          logSystemEvent({
            guildId: args.guildId,
            channelId: invocationChannelId,
            eventType: "CANON_DM_AUTOBIND",
            content: JSON.stringify({
              dm_user_id: invokerId,
              source: "first_canonical_wake",
            }),
            authorId: invokerId,
            authorName: args.interaction.user?.username ?? "unknown",
            narrativeWeight: "secondary",
          });
        } catch {
          // Do not block setup if telemetry logging fails.
        }
      } else {
        errors.push("Canonical wake requires DM identity binding, but invoker identity is unavailable");
      }
    }

    if (!getGuildDmUserId(args.guildId)) {
      errors.push("Canonical wake blocked: dm_user_id is not configured");
    }
  }

  const cfgNow = getGuildConfig(args.guildId);
  if (
    !cfgNow?.default_recap_style ||
    !["balanced", "concise", "detailed"].includes(cfgNow.default_recap_style)
  ) {
    setGuildDefaultRecapStyle(args.guildId, "balanced");
    applied.push("Initialized default recap style to balanced");
  }

  const textPerms = channel && botMember ? channel.permissionsFor(botMember) : null;
  const canSend = Boolean(textPerms?.has(PermissionFlagsBits.SendMessages));
  const canEmbed = Boolean(textPerms?.has(PermissionFlagsBits.EmbedLinks));
  const canAttach = Boolean(textPerms?.has(PermissionFlagsBits.AttachFiles));

  if (!canSend) {
    errors.push("Missing Send Messages permission in this channel");
  }
  if (!canEmbed) {
    warnings.push("Missing Embed Links permission in this channel");
  }
  if (!canAttach) {
    warnings.push("Missing Attach Files permission in this channel");
  }

  let canAttemptVoice = true;
  const homeVoiceId = getGuildHomeVoiceChannelId(args.guildId);
  if (homeVoiceId) {
    try {
      const voiceChannel = await guild.channels.fetch(homeVoiceId);
      if (!voiceChannel || !voiceChannel.isVoiceBased()) {
        warnings.push("Home voice channel is missing or not a voice channel");
        canAttemptVoice = false;
      } else {
        const voicePerms = voiceChannel.permissionsFor(botMember);
        const canConnect = Boolean(voicePerms?.has(PermissionFlagsBits.Connect));
        const canSpeak = Boolean(voicePerms?.has(PermissionFlagsBits.Speak));
        if (!canConnect || !canSpeak) {
          warnings.push("Missing Connect/Speak permission in home voice channel");
          canAttemptVoice = false;
        }
      }
    } catch {
      warnings.push("Could not validate home voice channel permissions");
      canAttemptVoice = false;
    }
  }

  const hasSafeElevatedPolicy = true;
  if (!hasSafeElevatedPolicy) {
    errors.push("No elevated auth policy configured");
  }

  if (!hasCampaignSlug) {
    errors.push("Campaign slug missing");
  }

  const requiredChecksPass = canSend && hasSafeElevatedPolicy && hasCampaignSlug;
  const previousSetupVersion = getGuildSetupVersion(args.guildId);
  let setupVersionChanged = false;
  if (requiredChecksPass && (previousSetupVersion ?? 0) < 1) {
    setGuildSetupVersion(args.guildId, 1);
    setupVersionChanged = true;
    applied.push("Setup version initialized to 1");
  }

  return {
    applied,
    warnings,
    errors,
    setupVersionChanged,
    canAttemptVoice,
  };
}
