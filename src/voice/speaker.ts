/**
 * Voice Speaker Pipeline (Task 4.3)
 *
 * Plays synthesized TTS audio into Discord voice channels.
 *
 * Architecture:
 * - One AudioPlayer per guild (created on demand)
 * - Per-guild playback queue using promise chaining
 * - MP3 buffer → AudioResource (prism-media handles transcoding)
 * - NoSubscriber audio player behavior (quiet by design)
 */

import {
  AudioPlayer,
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  NoSubscriberBehavior,
} from "@discordjs/voice";
import { Readable } from "node:stream";
import { getVoiceState } from "./state.js";

/**
 * Per-guild speaker state
 */
type GuildSpeaker = {
  player: AudioPlayer;
  playbackQueue: Promise<void>; // Promise chain for sequential playback
};

// Per-guild speaker instances
const guildSpeakers = new Map<string, GuildSpeaker>();

// Per-guild meepo-speaking status (for feedback loop protection)
const meepoSpeakingGuilds = new Set<string>();

/**
 * Get or create audio player for a guild
 */
function getOrCreatePlayer(guildId: string): AudioPlayer | null {
  const state = getVoiceState(guildId);
  if (!state) {
    console.warn(`[Speaker] No voice state for guild ${guildId}`);
    return null;
  }

  let speaker = guildSpeakers.get(guildId);
  if (!speaker) {
    const player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Pause,
      },
    });

    // Clean up on finish
    player.on(AudioPlayerStatus.Idle, () => {
      if (process.env.DEBUG_VOICE === "true") {
        console.log(`[Speaker] Playback finished for guild ${guildId}`);
      }
    });

    player.on("error", (err) => {
      console.error(`[Speaker] Audio player error for guild ${guildId}:`, err);
    });

    // Subscribe the player to the connection
    state.connection.subscribe(player);

    speaker = {
      player,
      playbackQueue: Promise.resolve(),
    };
    guildSpeakers.set(guildId, speaker);

    if (process.env.DEBUG_VOICE === "true") {
      console.log(`[Speaker] Created player for guild ${guildId}`);
    }
  }

  return speaker.player;
}

/**
 * Play MP3 buffer in a guild's voice channel.
 *
 * Queues playback sequentially to prevent overlap.
 * Returns immediately; playback happens asynchronously.
 *
 * @param guildId Guild ID
 * @param mp3Buffer MP3 audio bytes
 * @param meta Optional metadata (user name, duration hint, etc.)
 */
export function speakInGuild(
  guildId: string,
  mp3Buffer: Buffer,
  meta?: {
    userDisplayName?: string;
    durationMs?: number;
  }
): void {
  const state = getVoiceState(guildId);
  if (!state) {
    console.warn(
      `[Speaker] Not in voice for guild ${guildId}`
    );
    return;
  }

  const player = getOrCreatePlayer(guildId);
  if (!player) return;

  let speaker = guildSpeakers.get(guildId);
  if (!speaker) return; // Should not happen; getOrCreatePlayer would have created it

  // Queue playback via promise chaining
  const newQueue = speaker.playbackQueue
    .then(async () => {
      // Mark Meepo as speaking (for feedback loop protection)
      meepoSpeakingGuilds.add(guildId);

      // Create readable stream from buffer
      const stream = Readable.from([mp3Buffer]);

      // Create audio resource (prism-media auto-detects MP3, transcodes to Opus)
      const resource = createAudioResource(stream, {
        inlineVolume: true,
      });

      if (process.env.DEBUG_VOICE === "true") {
        const metaStr = meta?.userDisplayName
          ? ` (${meta.userDisplayName})`
          : "";
        console.log(
          `[Speaker] Playing ${mp3Buffer.length} bytes${metaStr} in guild ${guildId}`
        );
      }

      // Play resource
      player.play(resource);

      // Wait for playback to finish
      return new Promise<void>((resolve) => {
        const finishHandler = () => {
          player.off(AudioPlayerStatus.Idle, finishHandler);
          player.off("error", errorHandler);
          // Mark Meepo as done speaking
          meepoSpeakingGuilds.delete(guildId);
          resolve();
        };

        const errorHandler = () => {
          player.off(AudioPlayerStatus.Idle, finishHandler);
          player.off("error", errorHandler);
          // Mark Meepo as done speaking (even on error)
          meepoSpeakingGuilds.delete(guildId);
          resolve(); // Resolve anyway to keep queue moving
        };

        player.once(AudioPlayerStatus.Idle, finishHandler);
        player.once("error", errorHandler);
      });
    })
    .catch((err) => {
      console.error(
        `[Speaker] Playback error for guild ${guildId}:`,
        err
      );
    });

  speaker.playbackQueue = newQueue;
}

/**
 * Clean up speaker resources when leaving a guild
 */
export function cleanupSpeaker(guildId: string): void {
  const speaker = guildSpeakers.get(guildId);
  if (speaker) {
    speaker.player.stop(true);
    guildSpeakers.delete(guildId);
    if (process.env.DEBUG_VOICE === "true") {
      console.log(`[Speaker] Cleaned up speaker for guild ${guildId}`);
    }
  }
}

/**
 * Check if Meepo is currently speaking in a guild
 * (Used by receiver to prevent feedback loop via STT)
 */
export function isMeepoSpeaking(guildId: string): boolean {
  return meepoSpeakingGuilds.has(guildId);
}
