import { EndBehaviorType } from "@discordjs/voice";
import { getVoiceState } from "./state.js";
import { pipeline } from "node:stream";
import prism from "prism-media";
import { getSttProvider } from "./stt/provider.js";
import { normalizeTranscript } from "./stt/normalize.js";
import { appendLedgerEntry } from "../ledger/ledger.js";
import { randomBytes } from "node:crypto";

/**
 * Phase 2 Task 1-2: Speaking detection + PCM capture pipeline
 *
 * Key fixes:
 * - Prevent duplicate subscriptions per user (ignore repeated "start" while capturing)
 * - Finalize/cleanup on the audio stream ending (end/close/error), not on speaking "end"
 * - Filter click/noise by counting "active" PCM frames (20ms frames with energy)
 */

const DEBUG_VOICE = process.env.DEBUG_VOICE === "true";

// PCM format assumptions (Decoder configured as 48kHz, 2ch, 16-bit LE)
const RATE = 48000;
const CHANNELS = 2;
const BYTES_PER_SAMPLE = 2;
const BYTES_PER_SEC = RATE * CHANNELS * BYTES_PER_SAMPLE; // 192000

// Stream end behavior
const END_SILENCE_MS = 700;

// Conservative gating (err on allowing speech through)
const MIN_AUDIO_MS = 250;        // require at least 250ms worth of PCM bytes
const USER_COOLDOWN_MS = 300;    // prevent rapid retriggers
const LONG_AUDIO_MS = 1200;      // long utterances bypass the "activity" gate + cooldown

// Click filter: require enough "active" frames (energy) in the chunk
const FRAME_MS = 20;
const FRAME_BYTES = Math.round(BYTES_PER_SEC * (FRAME_MS / 1000)); // 3840 bytes for 20ms
const FRAME_RMS_THRESH = 700;    // permissive
const MIN_ACTIVE_MS = 200;       // require ~200ms of active audio (10 frames)

// Memory safety: max PCM buffer size (10 seconds @ 48kHz stereo 16-bit = ~2MB)
const MAX_PCM_BYTES = 10 * BYTES_PER_SEC; // 1,920,000 bytes

// Singleton STT provider (lazy-initialized)
let sttProvider: Awaited<ReturnType<typeof getSttProvider>> | null = null;

// Per-guild STT queue using promise chaining (Task 3.4)
// Maintains Promise<void> chain per guild to serialize transcriptions
// Guarantees: no overlapping STT calls, FIFO order, no skipped utterances
const guildSttChain = new Map<string, Promise<void>>();

// Track per guild listener so stopReceiver can detach cleanly
type ReceiverHandlers = {
  onStart: (userId: string) => void;
  onEnd: (userId: string) => void;
};
const receiverHandlers = new Map<string, ReceiverHandlers>();

type SpeakingSubscription = {
  userId: string;
  guildId: string;
  channelId: string;
  startedAt: number;
};

type PcmCapture = {
  userId: string;
  displayName: string; // member.displayName ?? user.username (cached at capture start)
  pcmChunks: Buffer[];
  totalBytes: number;
  startedAt: number;

  // Activity tracking (for click/noise filtering)
  remainder: Buffer;     // leftover bytes < FRAME_BYTES between chunks
  activeFrames: number;
  totalFrames: number;
  peak: number;
};

// Map<guildId, Map<userId, SpeakingSubscription>>
const activeSpeakers = new Map<string, Map<string, SpeakingSubscription>>();

// Map<guildId, Map<userId, PcmCapture>>
const pcmCaptures = new Map<string, Map<string, PcmCapture>>();

// Map<guildId, Map<userId, lastAcceptedEndMs>>
const userCooldowns = new Map<string, Map<string, number>>();

/**
 * Handle transcription and ledger emission for accepted audio.
 * Called serially per guild via promise chaining (see call site).
 */
async function handleTranscription(
  guildId: string,
  channelId: string,
  userId: string,
  displayName: string,
  cap: PcmCapture
): Promise<void> {
  try {
    // Lazy-initialize STT provider on first use
    if (!sttProvider) {
      sttProvider = await getSttProvider();
    }

    // Merge PCM chunks
    const pcmBuffer = Buffer.concat(cap.pcmChunks);
    
    // Memory safety check
    if (pcmBuffer.length > MAX_PCM_BYTES) {
      console.warn(
        `[STT] PCM buffer too large (${pcmBuffer.length} bytes), truncating to ${MAX_PCM_BYTES}`
      );
      // Transcribe anyway with truncated buffer (better than failing silently)
    }

    // Transcribe
    const result = await sttProvider.transcribePcm(
      pcmBuffer.length > MAX_PCM_BYTES ? pcmBuffer.subarray(0, MAX_PCM_BYTES) : pcmBuffer,
      RATE
    );

    // Task 3.8: Post-STT domain normalization (canonicalize entity names)
    const shouldNormalize = (process.env.STT_NORMALIZE_NAMES ?? "true").toLowerCase() !== "false";
    let normalizedText = result.text;

    if (shouldNormalize) {
      normalizedText = normalizeTranscript(result.text);

      if (DEBUG_VOICE && normalizedText !== result.text) {
        const rawPreview = result.text.substring(0, 120);
        const normPreview = normalizedText.substring(0, 120);
        console.log(
          `[STT] Normalized: "${rawPreview}${result.text.length > 120 ? "..." : ""}" → "${normPreview}${normalizedText.length > 120 ? "..." : ""}"`
        );
      }
    }

    // Discard empty transcriptions silently
    if (!normalizedText || normalizedText.trim() === "") {
      return;
    }

    // Generate unique message ID with random suffix to prevent millisecond collisions
    const randomSuffix = randomBytes(4).toString("hex");
    const messageId = `voice_${userId}_${cap.startedAt}_${randomSuffix}`;

    // Emit to ledger - voice is primary narrative by default
    appendLedgerEntry({
      guild_id: guildId,
      channel_id: channelId,
      message_id: messageId,
      author_id: userId,
      author_name: displayName, // Use member.displayName instead of fallback
      timestamp_ms: Date.now(),
      content: normalizedText,
      tags: "human",
      source: "voice",
      narrative_weight: "primary",
      speaker_id: userId,
      t_start_ms: cap.startedAt,
      t_end_ms: Date.now(),
      confidence: result.confidence ?? null,
    });

    console.log(
      `[STT] 📝 Ledger: ${displayName} (${userId}), text="${normalizedText}"${result.confidence ? `, confidence=${result.confidence.toFixed(2)}` : ""}`
    );
  } catch (err) {
    console.error(`[STT] Transcription failed for userId=${userId}:`, err);
  }
}

export function startReceiver(guildId: string): void {
  const state = getVoiceState(guildId);
  if (!state) {
    console.warn(`[Receiver] No voice state for guild ${guildId}`);
    return;
  }
  if (!state.sttEnabled) {
    console.warn(`[Receiver] STT not enabled for guild ${guildId}`);
    return;
  }

  // Idempotent: don't register twice
  if (receiverHandlers.has(guildId)) {
    if (DEBUG_VOICE) console.log(`[Receiver] Receiver already active for guild ${guildId}`);
    return;
  }

  const connection = state.connection;
  const channelId = state.channelId;

  if (!activeSpeakers.has(guildId)) activeSpeakers.set(guildId, new Map());
  if (!pcmCaptures.has(guildId)) pcmCaptures.set(guildId, new Map());
  if (!userCooldowns.has(guildId)) userCooldowns.set(guildId, new Map());

  console.log(`[Receiver] Starting receiver for guild ${guildId}, channel ${channelId}`);

  const onStart = async (userId: string) => {
    const speakers = activeSpeakers.get(guildId);
    const captures = pcmCaptures.get(guildId);
    if (!speakers || !captures) return;

    // Prevent duplicate subscriptions if Discord fires "start" repeatedly
    if (captures.has(userId)) {
      if (DEBUG_VOICE) console.log(`[Receiver] (dup start ignored) userId=${userId}`);
      return;
    }

    // Fetch fresh member data for display name
    let displayName = `User_${userId.slice(0, 8)}`;
    try {
      if (state.guild) {
        const member = await state.guild.members.fetch(userId);
        displayName = member.displayName ?? member.user?.username ?? displayName;
      }
    } catch (err: any) {
      if (DEBUG_VOICE) console.log(`[Receiver] Could not fetch member display name for ${userId}:`, err.message);
      // displayName stays as fallback
    }

    const startedAt = Date.now();
    speakers.set(userId, { userId, guildId, channelId, startedAt });

    if (DEBUG_VOICE) {
      console.log(
        `[Receiver] 🎤 Speaking started: ${displayName} (${userId}), guild=${guildId}, channel=${channelId}`
      );
    }

    // Create a capture record first
    captures.set(userId, {
      userId,
      displayName,
      pcmChunks: [],
      totalBytes: 0,
      startedAt,
      remainder: Buffer.alloc(0),
      activeFrames: 0,
      totalFrames: 0,
      peak: 0,
    });

    const audioStream = connection.receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: END_SILENCE_MS },
    });

    const opusDecoder = new prism.opus.Decoder({
      rate: RATE,
      channels: CHANNELS,
      frameSize: 960,
    });

    // PCM handler: collect bytes + update frame activity
    opusDecoder.on("data", (pcmChunk: Buffer) => {
      const cap = captures.get(userId);
      if (!cap) return;

      cap.pcmChunks.push(pcmChunk);
      cap.totalBytes += pcmChunk.length;

      // Update activity stats on 20ms frames
      cap.remainder = Buffer.concat([cap.remainder, pcmChunk]);

      while (cap.remainder.length >= FRAME_BYTES) {
        const frame = cap.remainder.subarray(0, FRAME_BYTES);
        cap.remainder = cap.remainder.subarray(FRAME_BYTES);

        // Cheap RMS/peak: sample every 4 bytes (every other int16)
        let sumSq = 0;
        let count = 0;
        let peak = 0;

        for (let i = 0; i + 1 < frame.length; i += 4) {
          const s = frame.readInt16LE(i);
          const a = Math.abs(s);
          if (a > peak) peak = a;
          sumSq += s * s;
          count++;
        }

        const rms = Math.sqrt(sumSq / Math.max(1, count));
        cap.totalFrames++;
        if (peak > cap.peak) cap.peak = peak;

        if (rms >= FRAME_RMS_THRESH) cap.activeFrames++;
      }
    });

    const finalize = (reason: string, err?: unknown) => {
      const now = Date.now();
      const cap = captures.get(userId);
      if (!cap) return; // already finalized

      const wallClockMs = now - cap.startedAt;
      const audioMs = cap.totalBytes > 0 ? Math.round((cap.totalBytes / BYTES_PER_SEC) * 1000) : 0;
      const activeMs = cap.activeFrames * FRAME_MS;

      let shouldAccept = true;
      let gateReason = "";

      // Gate 1: min audio bytes-derived duration
      if (audioMs < MIN_AUDIO_MS) {
        shouldAccept = false;
        gateReason = `too short (audioMs=${audioMs} < ${MIN_AUDIO_MS})`;
      }

      // Gate 2: activity gate (filters long-silence click padding)
      // Long audio bypasses this entirely (conservative)
      if (shouldAccept && audioMs < LONG_AUDIO_MS) {
        if (activeMs < MIN_ACTIVE_MS) {
          shouldAccept = false;
          gateReason = `too quiet (activeMs=${activeMs} < ${MIN_ACTIVE_MS}, peak=${cap.peak})`;
        }
      }

      // Gate 3: per-user cooldown (unless long audio)
      if (shouldAccept && audioMs < LONG_AUDIO_MS) {
        const cooldowns = userCooldowns.get(guildId);
        if (cooldowns) {
          const lastAccepted = cooldowns.get(userId) ?? 0;
          const since = now - lastAccepted;
          if (since < USER_COOLDOWN_MS) {
            shouldAccept = false;
            gateReason = `cooldown (${since}ms < ${USER_COOLDOWN_MS}ms)`;
          }
        }
      }

      try {
        if (shouldAccept) {
          userCooldowns.get(guildId)?.set(userId, now);
          console.log(
            `[Receiver] 🔇 Speaking ended: ${cap.displayName} (${userId}), wallClockMs=${wallClockMs}, pcmBytes=${cap.totalBytes}, audioMs=${audioMs}, activeMs=${activeMs}, peak=${cap.peak}`
          );

          // Queue transcription via promise chain (ensures serial, FIFO execution per guild)
          const currentChain = guildSttChain.get(guildId) ?? Promise.resolve();
          const newChain = currentChain
            .then(() => handleTranscription(guildId, channelId, userId, cap.displayName, cap))
            .catch((err) => {
              console.error(`[Receiver] handleTranscription error for userId=${userId}:`, err);
            });
          guildSttChain.set(guildId, newChain);
        } else if (DEBUG_VOICE) {
          console.log(
            `[Receiver] 🚫 Gated: userId=${userId}, reason=${gateReason}, wallClockMs=${wallClockMs}, pcmBytes=${cap.totalBytes}, audioMs=${audioMs}, activeMs=${activeMs}, peak=${cap.peak}`
          );
        }

        if (err && DEBUG_VOICE) {
          console.error(`[Receiver] finalize reason=${reason} userId=${userId}`, err);
        }
      } finally {
        // ALWAYS cleanup to prevent duplicates/leaks
        speakers.delete(userId);
        captures.delete(userId);
      }
    };

    // Finalize on stream lifecycle (reliable)
    audioStream.once("end", () => finalize("stream_end"));
    audioStream.once("close", () => finalize("stream_close"));
    audioStream.once("error", (e) => finalize("stream_error", e));
    opusDecoder.once("error", (e) => finalize("decoder_error", e));

    pipeline(audioStream, opusDecoder, (e) => {
      if (e) finalize("pipeline_error", e);
    });
  };

  // Speaking "end" event is not needed - we finalize on stream end
  const onEnd = (userId: string) => {
    // No-op: stream lifecycle handles cleanup
  };

  receiverHandlers.set(guildId, { onStart, onEnd });
  connection.receiver.speaking.on("start", onStart);
  connection.receiver.speaking.on("end", onEnd);
}

export function stopReceiver(guildId: string): void {
  const state = getVoiceState(guildId);
  if (!state) {
    console.log(`[Receiver] No voice state for guild ${guildId}, nothing to stop`);
    return;
  }

  console.log(`[Receiver] Stopping receiver for guild ${guildId}`);

  const handlers = receiverHandlers.get(guildId);
  if (handlers) {
    state.connection.receiver.speaking.off("start", handlers.onStart);
    state.connection.receiver.speaking.off("end", handlers.onEnd);
    receiverHandlers.delete(guildId);
  } else {
    // Fallback: no known handlers; avoid nuking other listeners unexpectedly
    if (DEBUG_VOICE) console.log(`[Receiver] No handler record for guild ${guildId}`);
  }

  activeSpeakers.get(guildId)?.clear();
  activeSpeakers.delete(guildId);

  pcmCaptures.get(guildId)?.clear();
  pcmCaptures.delete(guildId);

  userCooldowns.get(guildId)?.clear();
  userCooldowns.delete(guildId);
}

export function isReceiverActive(guildId: string): boolean {
  return receiverHandlers.has(guildId);
}
