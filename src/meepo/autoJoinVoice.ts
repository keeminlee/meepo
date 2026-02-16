import { Client, Guild } from "discord.js";
import { log } from "../utils/logger.js";
import { joinVoice } from "../voice/connection.js";
import { getVoiceState, setVoiceState } from "../voice/state.js";
import { startReceiver } from "../voice/receiver.js";
import { logSystemEvent } from "../ledger/system.js";

const meepoLog = log.withScope("meepo");

/**
 * Auto-join the General voice channel when Meepo wakes.
 * This makes Meepo available for voice interactions immediately upon waking.
 * 
 * If already connected to General (e.g., from overlay auto-join), ensures STT is running.
 * 
 * Called from:
 * - /meepo wake command
 * - Auto-wake via message containing "meepo"
 */
export async function autoJoinGeneralVoice(opts: {
  client: Client;
  guildId: string;
  channelId: string; // Text channel for logging
}): Promise<void> {
  const generalVoiceChannelId = process.env.MEEPO_HOME_VOICE_CHANNEL_ID;
  
  if (!generalVoiceChannelId) {
    meepoLog.debug("MEEPO_HOME_VOICE_CHANNEL_ID not set, skipping auto-join");
    return;
  }

  // Check if already connected to General
  const currentState = getVoiceState(opts.guildId);
  if (currentState && currentState.channelId === generalVoiceChannelId) {
    meepoLog.debug("Already in General voice channel");
    
    // Ensure STT is enabled and receiver is running
    if (!currentState.sttEnabled) {
      currentState.sttEnabled = true;
      meepoLog.debug("Enabled STT for existing connection");
    }
    
    startReceiver(opts.guildId); // Idempotent - won't duplicate if already running
    
    return;
  }

  // Need to join General
  try {
    const guild = await opts.client.guilds.fetch(opts.guildId);
    const voiceChannel = await guild.channels.fetch(generalVoiceChannelId);
    
    if (!voiceChannel || !voiceChannel.isVoiceBased()) {
      meepoLog.warn(`Channel ${generalVoiceChannelId} is not a voice channel`);
      return;
    }

    const connection = await joinVoice({
      guildId: opts.guildId,
      channelId: generalVoiceChannelId,
      adapterCreator: guild.voiceAdapterCreator,
    });

    // Set voice state with STT always enabled
    setVoiceState(opts.guildId, {
      channelId: generalVoiceChannelId,
      connection,
      guild,
      sttEnabled: true, // ← Always enable STT when joining voice
      connectedAt: Date.now(),
    });

    // Start receiver for STT
    startReceiver(opts.guildId);

    // Log system event
    logSystemEvent({
      guildId: opts.guildId,
      channelId: opts.channelId,
      eventType: "voice_join",
      content: `Meepo auto-joined General voice channel on wake`,
      authorId: "system",
      authorName: "SYSTEM",
      narrativeWeight: "secondary",
    });

    meepoLog.info(`Joined General voice channel and started STT`);
  } catch (err: any) {
    meepoLog.error(`Failed to join General voice channel: ${err.message ?? err}`);
  }
}
