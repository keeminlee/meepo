import {
  joinVoiceChannel,
  VoiceConnection,
  VoiceConnectionStatus,
  entersState,
} from "@discordjs/voice";
import { log } from "../utils/logger.js";
import { getVoiceState, setVoiceState, clearVoiceState } from "./state.js";
import { stopReceiver } from "./receiver.js";
import { cleanupSpeaker } from "./speaker.js";
import { overlayEmitPresence } from "../overlay/server.js";

const voiceLog = log.withScope("voice");
const overlayLog = log.withScope("overlay");

/**
 * Join a voice channel
 * 
 * Configuration:
 * - selfDeaf: false (receiver-ready for Phase 2 STT)
 * - selfMute: true (listen-only, no TTS in Phase 1)
 * 
 * @returns VoiceConnection ready for use
 * @throws Error if connection fails
 */
export async function joinVoice(opts: {
  guildId: string;
  channelId: string;
  adapterCreator: any;
}): Promise<VoiceConnection> {
  const connection = joinVoiceChannel({
    channelId: opts.channelId,
    guildId: opts.guildId,
    adapterCreator: opts.adapterCreator,
    selfDeaf: false, // Receiver-ready for Phase 2
    selfMute: true,  // Listen-only for Phase 1
  });

  // Wait for Ready state (required for receiver setup)
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
  } catch (err) {
    connection.destroy();
    throw new Error("Failed to establish voice connection within 10 seconds");
  }

  // Set up disconnect handlers to keep state clean
  setupDisconnectHandlers(connection, opts.guildId);

  return connection;
}

/**
 * Leave voice channel and clean up state
 */
export function leaveVoice(guildId: string): void {
  const state = getVoiceState(guildId);
  if (!state) {
    return; // Already disconnected
  }

  stopReceiver(guildId);
  cleanupSpeaker(guildId);
  state.connection.destroy();
  clearVoiceState(guildId);
  
  // Clear Meepo's overlay presence
  overlayEmitPresence("meepo", false);
  overlayLog.debug(`Cleared Meepo presence on leave`);
}

/**
 * Set up disconnect handlers to keep state synchronized
 * 
 * Handles:
 * - Network issues (auto-reconnect attempt)
 * - Manual disconnects
 * - State cleanup on Destroyed
 */
function setupDisconnectHandlers(connection: VoiceConnection, guildId: string): void {
  connection.on("stateChange", (oldState, newState) => {
    voiceLog.debug(`Voice state: ${oldState.status} → ${newState.status}`);

    // Clean up state when connection is destroyed
    if (newState.status === VoiceConnectionStatus.Destroyed) {
      stopReceiver(guildId);
      cleanupSpeaker(guildId);
      clearVoiceState(guildId);
      
      // Clear Meepo's overlay presence
      overlayEmitPresence("meepo", false);
      
      voiceLog.debug(`Voice state cleared (destroyed)`);
    }

    // Attempt reconnection on disconnect (short window)
    if (newState.status === VoiceConnectionStatus.Disconnected) {
      voiceLog.debug(`Voice disconnected, attempting to reconnect...`);
      
      entersState(connection, VoiceConnectionStatus.Ready, 5_000)
        .then(() => {
          voiceLog.debug(`Voice reconnected successfully`);
        })
        .catch(() => {
          voiceLog.debug(`Voice reconnection failed, destroying connection`);
          connection.destroy();
        });
    }
  });

  connection.on("error", (error) => {
    voiceLog.error(`Voice connection error: ${error}`);
  });
}
