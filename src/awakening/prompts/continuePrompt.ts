import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

export const AWAKEN_CONTINUE_CUSTOM_ID_PREFIX = "meepo_awaken_continue";
export const AWAKEN_CONTINUE_KEY = "__continue__";

export type ParsedContinueCustomId = {
  nonce: string;
};

export function buildContinueCustomId(args: {
  nonce: string;
}): string {
  return [
    AWAKEN_CONTINUE_CUSTOM_ID_PREFIX,
    encodeURIComponent(args.nonce),
  ].join(":");
}

export function parseContinueCustomId(customId: string): ParsedContinueCustomId | null {
  if (!customId.startsWith(`${AWAKEN_CONTINUE_CUSTOM_ID_PREFIX}:`)) return null;
  const parts = customId.split(":");
  if (parts.length !== 2 && parts.length !== 5) return null;

  try {
    // Legacy continue IDs had the nonce in the 5th segment.
    const nonceRaw = parts.length === 5 ? parts[4] : parts[1];
    const nonce = decodeURIComponent(nonceRaw ?? "").trim();
    if (!nonce) return null;
    return { nonce };
  } catch {
    return null;
  }
}

export function buildContinuePromptPayload(args: {
  nonce: string;
}): {
  content: string;
  components: ActionRowBuilder<ButtonBuilder>[];
  ephemeral: false;
} {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildContinueCustomId(args))
      .setLabel("Continue (DM)")
      .setStyle(ButtonStyle.Primary)
  );

  return {
    content: "Continue when the table is ready.",
    components: [row],
    ephemeral: false,
  };
}