import { getGuildDmUserId, resolveCampaignSlug } from "../campaign/guildConfig.js";
import { loadRegistry } from "../registry/loadRegistry.js";

export type SpeakerKind = "dm" | "player";

export const SPEAKER_PREFIX_REGEX = /^\s*[^:\n]{1,32}:\s/;

export function hasExistingSpeakerPrefix(content: string): boolean {
  return SPEAKER_PREFIX_REGEX.test(content);
}

export function formatSpeakerLine(label: string, content: string): string {
  if (hasExistingSpeakerPrefix(content)) {
    return content;
  }
  return `${label}: ${content}`;
}

export async function resolveSpeakerLabel(args: {
  guildId: string;
  campaignId?: string | null;
  sessionId?: string | null;
  authorId: string;
  discordDisplayName: string;
  canonMode: boolean;
}): Promise<string> {
  const result = await resolveSpeakerAttribution(args);
  return result.label;
}

export async function resolveSpeakerAttribution(args: {
  guildId: string;
  campaignId?: string | null;
  sessionId?: string | null;
  authorId: string;
  discordDisplayName: string;
  canonMode: boolean;
}): Promise<{ label: string; kind: SpeakerKind }> {
  if (!args.canonMode) {
    return { label: args.discordDisplayName, kind: "player" };
  }

  const dmUserId = getGuildDmUserId(args.guildId);
  if (dmUserId && dmUserId === args.authorId) {
    return { label: "DM", kind: "dm" };
  }

  try {
    const campaignSlug = args.campaignId ?? resolveCampaignSlug({ guildId: args.guildId });
    const registry = loadRegistry({ campaignSlug });
    const mappedPc = registry.byDiscordUserId.get(args.authorId);
    if (mappedPc) {
      return { label: mappedPc.canonical_name, kind: "player" };
    }
  } catch {
    return { label: args.discordDisplayName, kind: "player" };
  }

  return { label: args.discordDisplayName, kind: "player" };
}
