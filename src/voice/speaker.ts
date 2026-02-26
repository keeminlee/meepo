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
import { log } from "../utils/logger.js";
import { getVoiceState } from "./state.js";
import { overlayEmitSpeaking } from "../overlay/server.js";
import { cfg } from "../config/env.js";
import { voicePlaybackController } from "./voicePlaybackController.js";

const voiceLog = log.withScope("voice");

/**
 * Per-guild speaker state
 */
type GuildSpeaker = {
  player: AudioPlayer;
  playbackQueue: Promise<void>; // Promise chain for sequential playback
  meepoSpeakRefCount: number; // Refcount for overlay speaking (handles multi-chunk TTS)
  queueGeneration: number;
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
    voiceLog.warn(`No voice state`);
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
      if (cfg.voice.debug) {
        voiceLog.debug(`Playback finished`);
      }
    });

    player.on("error", (err) => {
      voiceLog.error(`Audio player error: ${err}`);
    });

    // Subscribe the player to the connection
    state.connection.subscribe(player);

    speaker = {
      player,
      playbackQueue: Promise.resolve(),
      meepoSpeakRefCount: 0,
      queueGeneration: 0,
    };
    guildSpeakers.set(guildId, speaker);

    voicePlaybackController.registerAbortHandler(guildId, (reason) => {
      const activeSpeaker = guildSpeakers.get(guildId);
      if (!activeSpeaker) {
        return;
      }

      activeSpeaker.queueGeneration += 1;
      activeSpeaker.player.stop(true);
      if (activeSpeaker.meepoSpeakRefCount > 0) {
        overlayEmitSpeaking("meepo", false, {
          immediate: true,
          reason: "interrupted",
        });
      }
      activeSpeaker.meepoSpeakRefCount = 0;
      meepoSpeakingGuilds.delete(guildId);
      voicePlaybackController.setIsSpeaking(guildId, false);

      if (cfg.voice.debug) {
        voiceLog.debug(`Playback aborted (${reason})`);
      }
    });

    if (cfg.voice.debug) {
      voiceLog.debug(`Created audio player`);
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
    voiceLog.warn(
      `Not in voice for guild ${guildId}`
    );
    return;
  }

  const player = getOrCreatePlayer(guildId);
  if (!player) return;

  let speaker = guildSpeakers.get(guildId);
  if (!speaker) return; // Should not happen; getOrCreatePlayer would have created it

  const enqueueGeneration = speaker.queueGeneration;

  // Queue playback via promise chaining
  const newQueue = speaker.playbackQueue
    .then(async () => {
      if (enqueueGeneration !== speaker.queueGeneration) {
        return;
      }

      await voicePlaybackController.speak(guildId, async ({ signal, isCurrent }) => {
        if (!isCurrent() || enqueueGeneration !== speaker.queueGeneration || signal.aborted) {
          return;
        }

        meepoSpeakingGuilds.add(guildId);
        voicePlaybackController.setIsSpeaking(guildId, true);

        speaker.meepoSpeakRefCount++;
        if (speaker.meepoSpeakRefCount === 1) {
          overlayEmitSpeaking("meepo", true);
        }

        const stream = Readable.from([mp3Buffer]);
        const resource = createAudioResource(stream, {
          inlineVolume: true,
        });

        if (cfg.voice.debug) {
          const metaStr = meta?.userDisplayName
            ? ` (${meta.userDisplayName})`
            : "";
          voiceLog.debug(
            `Playing ${mp3Buffer.length} bytes${metaStr}`
          );
        }

        player.play(resource);

        await new Promise<void>((resolve) => {
          let settled = false;

          const finishPlayback = (reason?: string) => {
            if (settled) {
              return;
            }
            settled = true;

            player.off(AudioPlayerStatus.Idle, finishHandler);
            player.off("error", errorHandler);
            signal.removeEventListener("abort", abortHandler);

            speaker.meepoSpeakRefCount = Math.max(0, speaker.meepoSpeakRefCount - 1);
            if (speaker.meepoSpeakRefCount === 0) {
              overlayEmitSpeaking("meepo", false, reason ? { reason } : undefined);
            }

            if (speaker.meepoSpeakRefCount === 0) {
              meepoSpeakingGuilds.delete(guildId);
              voicePlaybackController.setIsSpeaking(guildId, false);
            }

            resolve();
          };

          const finishHandler = () => {
            finishPlayback();
          };

          const errorHandler = () => {
            finishPlayback();
          };

          const abortHandler = () => {
            player.stop(true);
            finishPlayback("interrupted");
          };

          player.once(AudioPlayerStatus.Idle, finishHandler);
          player.once("error", errorHandler);
          signal.addEventListener("abort", abortHandler, { once: true });
        });
      });
    })
    .catch((err) => {
      voiceLog.error(
        `Playback error: ${err}`
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
    voicePlaybackController.abort(guildId, "cleanup_speaker");
    speaker.player.stop(true);
    // Reset refcount and emit false if we were speaking
    if (speaker.meepoSpeakRefCount > 0) {
      overlayEmitSpeaking("meepo", false, { immediate: true });
      speaker.meepoSpeakRefCount = 0;
    }
    voicePlaybackController.unregisterAbortHandler(guildId);
    voicePlaybackController.resetGuild(guildId);
    meepoSpeakingGuilds.delete(guildId);
    guildSpeakers.delete(guildId);
    if (cfg.voice.debug) {
      voiceLog.debug(`Cleaned up speaker`);
    }
  }
}

/**
 * Check if Meepo is currently speaking in a guild
 * (Used by receiver to prevent feedback loop via STT)
 */
export function isMeepoSpeaking(guildId: string): boolean {
  return meepoSpeakingGuilds.has(guildId) || voicePlaybackController.getIsSpeaking(guildId);
}
