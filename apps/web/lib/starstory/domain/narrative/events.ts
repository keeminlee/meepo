export type NarrativeEvent =
  | { type: "SKY_ENTERED"; at: number }
  | { type: "PROTO_STAR_SPAWNED"; at: number; starId: string }
  | { type: "PROTO_STAR_CLICKED"; at: number }
  | { type: "CHRONICLE_STARTED"; at: number; campaignName: string }
  | { type: "DISCORD_INSTALL_COMPLETED"; at: number; guildId: string }
  | { type: "AWAKENING_COMPLETED"; at: number }
  | { type: "TRANSCRIPT_UPDATED"; at: number; transcriptLineCount: number }
  | { type: "VALIDATION_STARTED"; at: number }
  | { type: "CHRONICLE_VALIDATED"; at: number }
  | { type: "CHRONICLE_REJECTED"; at: number; reason: string };
