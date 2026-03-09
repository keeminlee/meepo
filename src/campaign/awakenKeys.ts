export type AwakenGuildConfigControl = "text_channel" | "voice_channel" | "role" | "choice" | "flag";

export type AwakenGuildConfigKeySpec = {
  key: string;
  control: AwakenGuildConfigControl;
  editable: boolean;
  choices?: string[];
};

export const AWAKEN_GUILD_CONFIG_KEYS: ReadonlyArray<AwakenGuildConfigKeySpec> = [
  { key: "home_text_channel_id", control: "text_channel", editable: true },
  { key: "home_voice_channel_id", control: "voice_channel", editable: true },
  { key: "dm_role_id", control: "role", editable: true },
  { key: "default_talk_mode", control: "choice", editable: true, choices: ["hush", "talk"] },
  { key: "meta_campaign_slug", control: "choice", editable: false },
  { key: "awakened", control: "flag", editable: false },
] as const;
