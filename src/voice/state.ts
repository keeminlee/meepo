import { VoiceConnection } from "@discordjs/voice";

/**
 * Voice state for a guild
 * In-memory only (Phase 1) - resets on bot restart
 */
export type VoiceState = {
  channelId: string;
  connection: VoiceConnection;
  sttEnabled: boolean;
  connectedAt: number;
};

/**
 * In-memory voice state store
 * Map<guildId, VoiceState>
 */
const voiceStates = new Map<string, VoiceState>();

/**
 * Get current voice state for a guild
 */
export function getVoiceState(guildId: string): VoiceState | null {
  return voiceStates.get(guildId) ?? null;
}

/**
 * Set voice state for a guild
 */
export function setVoiceState(guildId: string, state: VoiceState): void {
  voiceStates.set(guildId, state);
}

/**
 * Clear voice state for a guild
 */
export function clearVoiceState(guildId: string): void {
  voiceStates.delete(guildId);
}

/**
 * Get all active guild IDs with voice state
 */
export function getActiveGuilds(): string[] {
  return Array.from(voiceStates.keys());
}
