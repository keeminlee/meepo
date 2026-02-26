import { EndBehaviorType } from "@discordjs/voice";
import { getVoiceState } from "./state.js";
import { pipeline } from "node:stream";
import prism from "prism-media";
import { getSttProvider } from "./stt/provider.js";
import type { SttTranscriptionMeta } from "./stt/provider.js";
import { normalizeText } from "../registry/normalizeText.js";
import { appendLedgerEntry } from "../ledger/ledger.js";
import { isLatchAnchor, hasMeepoInLine } from "./wakeword.js";
import { respondToVoiceUtterance } from "./voiceReply.js";
import { getActiveMeepo } from "../meepo/state.js";
import { getActivePersonaId } from "../meepo/personaState.js";
import {
  setLatch,
  isLatchActive,
  DEFAULT_LATCH_SECONDS,
  DEFAULT_MAX_LATCH_TURNS,
} from "../latch/latch.js";
import { getActiveSession } from "../sessions/sessions.js";
import { getGuildMode } from "../sessions/sessionRuntime.js";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pcmToWav } from "./stt/wav.js";
import { log } from "../utils/logger.js";
import { overlayEmitSpeaking } from "../overlay/server.js";
import { cfg } from "../config/env.js";
import { voicePlaybackController } from "./voicePlaybackController.js";

/**
 * Phase 2 Task 1-2: Speaking detection + PCM capture pipeline
 *
 * Key fixes:
 * - Prevent duplicate subscriptions per user (ignore repeated "start" while capturing)
 * - Finalize/cleanup on the audio stream ending (end/close/error), not on speaking "end"
 * - Filter click/noise by counting "active" PCM frames (20ms frames with energy)
 */

const voiceLog = log.withScope("voice");

// PCM format assumptions (Decoder configured as 48kHz, 2ch, 16-bit LE)
const RATE = 48000;
const CHANNELS = 2;
const BYTES_PER_SAMPLE = 2;
const BYTES_PER_SEC = RATE * CHANNELS * BYTES_PER_SAMPLE; // 192000

// Stream end behavior
const END_SILENCE_MS = cfg.voice.endSilenceMs;

// Conservative gating (err on allowing speech through)
const USER_COOLDOWN_MS = 300;    // prevent rapid retriggers

// Audio silence threshold for overlay speaking detection
const AUDIO_SILENCE_THRESHOLD_MS = 150; // emit speaking=false after 150ms with no packets

// Click filter: require enough "active" frames (energy) in the chunk
const FRAME_MS = 20;
const FRAME_BYTES = Math.round(BYTES_PER_SEC * (FRAME_MS / 1000)); // 3840 bytes for 20ms
const FRAME_RMS_THRESH = 700;    // permissive
const MIN_MEANINGFUL_TOKENS = 3;
const MIN_SINGLE_MEANINGFUL_TOKEN_LEN = 4;
const AVG_LOGPROB_MIN = -1.0;
const FILLER_TOKENS = new Set<string>(["um", "uh", "hmm", "erm", "mmm"]);
const TOKEN_COUNT_BYPASS_KEYWORDS = new Set<string>(["meepo", "stop", "shush"]);

// Memory safety: max PCM buffer size (20 seconds @ 48kHz stereo 16-bit = ~4MB)
const MAX_PCM_BYTES = 60 * BYTES_PER_SEC; // 3,840,000 bytes

// Explicit STT noise phrases to drop before ledger/reply handling.
const BLOCKED_STT_PHRASES = new Set<string>([
  "thank you for watching",
]);

const STOP_STT_PHRASES = new Set<string>([
  "meepo stop",
  "meepo shush",
  "stop meepo",
]);

function normalizeSttPhrase(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isBlockedSttTranscript(text: string): boolean {
  return BLOCKED_STT_PHRASES.has(normalizeSttPhrase(text));
}

function isExplicitStopPhrase(text: string): boolean {
  const normalized = normalizeSttPhrase(text);
  if (STOP_STT_PHRASES.has(normalized)) {
    return true;
  }

  for (const stopPhrase of STOP_STT_PHRASES) {
    if (normalized.includes(stopPhrase)) {
      return true;
    }
  }

  return false;
}

// Singleton STT provider (lazy-initialized)
let sttProvider: Awaited<ReturnType<typeof getSttProvider>> | null = null;

// Per-guild STT queue using promise chaining (Task 3.4)
// Maintains Promise<void> chain per guild to serialize transcriptions
// Guarantees: no overlapping STT calls, FIFO order, no skipped utterances
const guildSttChain = new Map<string, Promise<void>>();

// Track overlay speaking state per user
// Maps guildId -> userId -> { idleTimer: NodeJS.Timeout | null, hasEmittedTrue: boolean }
const overlayUserState = new Map<string, Map<string, { idleTimer: NodeJS.Timeout | null; hasEmittedTrue: boolean }>>();

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
  isBargeIn: boolean;

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

export type ClipGateInput = {
  audioMs: number;
  activeMs: number;
  text?: string;
  meta?: SttTranscriptionMeta;
  flags?: {
    isBargeIn?: boolean;
    checkTextGates?: boolean;
  };
};

export type ClipGateResult = {
  accepted: boolean;
  reasons: string[];
  ratio: number;
};

function pickSnippet(text?: string): string {
  if (!text) return "";
  const trimmed = text.trim();
  if (!trimmed) return "";
  return trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed;
}

function extractMeaningfulTokens(normalizedText: string): string[] {
  return normalizedText
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !FILLER_TOKENS.has(token));
}

function hasTokenBypassKeyword(normalizedText: string): boolean {
  const tokens = normalizedText.split(" ").map((token) => token.trim()).filter(Boolean);
  return tokens.some((token) => TOKEN_COUNT_BYPASS_KEYWORDS.has(token));
}

export function evaluateClipGate(input: ClipGateInput): ClipGateResult {
  const reasons: string[] = [];
  const ratio = input.audioMs > 0 ? input.activeMs / input.audioMs : 0;

  if (input.audioMs < cfg.stt.minAudioMs) {
    reasons.push(`audio_too_short:${input.audioMs}<${cfg.stt.minAudioMs}`);
    return {
      accepted: false,
      reasons,
      ratio,
    };
  }

  if (ratio < cfg.stt.minActiveRatio) {
    reasons.push(`active_ratio_low:${ratio.toFixed(2)}<${cfg.stt.minActiveRatio}`);
  }

  if (typeof input.meta?.noSpeechProb === "number" && input.meta.noSpeechProb > cfg.stt.noSpeechProbMax) {
    reasons.push(`no_speech_prob_high:${input.meta.noSpeechProb.toFixed(2)}>${cfg.stt.noSpeechProbMax}`);
  }

  if (typeof input.meta?.avgLogprob === "number" && input.meta.avgLogprob < AVG_LOGPROB_MIN) {
    reasons.push(`avg_logprob_low:${input.meta.avgLogprob.toFixed(2)}<${AVG_LOGPROB_MIN}`);
  }

  const shouldCheckTextGates = input.flags?.checkTextGates ?? true;
  const rawText = (input.text ?? "").trim();

  if (shouldCheckTextGates && rawText) {
    const normalizedText = normalizeSttPhrase(rawText);
    const meaningfulTokens = extractMeaningfulTokens(normalizedText);

    if (meaningfulTokens.length === 0) {
      reasons.push("filler_only");
    } else {
      const bypassTokenCountGate = hasTokenBypassKeyword(normalizedText);
      if (!bypassTokenCountGate) {
        const hasLongMeaningfulToken = meaningfulTokens.some(
          (token) => token.length >= MIN_SINGLE_MEANINGFUL_TOKEN_LEN
        );
        if (meaningfulTokens.length < MIN_MEANINGFUL_TOKENS && !hasLongMeaningfulToken) {
          reasons.push("text_not_meaningful_enough");
        }
      }
    }
  }

  return {
    accepted: reasons.length === 0,
    reasons,
    ratio,
  };
}

function logGateRejection(input: {
  guildId: string;
  userId: string;
  reasons: string[];
  audioMs: number;
  activeMs: number;
  ratio: number;
  text?: string;
  meta?: SttTranscriptionMeta;
  isBargeIn?: boolean;
}): void {
  voiceLog.info(
    `🚫 STT_REJECT guild=${input.guildId} user=${input.userId} reasons=${input.reasons.join("|")} audioMs=${input.audioMs} activeMs=${input.activeMs} ratio=${input.ratio.toFixed(2)} noSpeechProb=${input.meta?.noSpeechProb ?? "n/a"} avgLogprob=${input.meta?.avgLogprob ?? "n/a"} bargeIn=${input.isBargeIn ? 1 : 0} text="${pickSnippet(input.text)}"`
  );
}

/**
 * Save audio chunk to disk if STT_SAVE_AUDIO=true
 * Creates: data/audio/{guildId}/{startedAt}/{userId}_{displayName}.wav
 * Returns: path relative to workspace, or null if saving disabled
 */
async function saveAudioChunk(
  guildId: string,
  userId: string,
  displayName: string,
  wavBuffer: Buffer,
  startedAt: number
): Promise<string | null> {
  const shouldSave = cfg.stt.saveAudio;
  if (!shouldSave) {
    return null;
  }

  try {
    // Create directory structure: data/audio/{guildId}/{timestamp}/
    const dirPath = join("data", "audio", guildId, String(startedAt));
    await mkdir(dirPath, { recursive: true });

    // Sanitize displayName for filename (replace non-alphanumeric)
    const safeName = displayName.replace(/[^\w-]/g, "_");
    const filename = `${userId}_${safeName}.wav`;
    const filePath = join(dirPath, filename);

    // Write WAV file
    await writeFile(filePath, wavBuffer);

    voiceLog.debug(`💾 Audio saved: ${filePath} (${wavBuffer.length} bytes)`);

    return filePath;
  } catch (err) {
    voiceLog.error(`Failed to save audio: ${err}`);
    return null;
  }
}

/**
 * Helper to manage overlay speaking state for a user
 * On first packet: emit speaking=true and start idle timer
 * On subsequent packets: reset idle timer
 * On idle timeout: emit speaking=false
 */
function updateOverlaySpeakingActivity(guildId: string, userId: string) {
  if (!overlayUserState.has(guildId)) {
    overlayUserState.set(guildId, new Map());
  }

  const guildState = overlayUserState.get(guildId)!;
  let userState = guildState.get(userId);

  if (!userState) {
    // First packet: emit speaking=true
    userState = { idleTimer: null, hasEmittedTrue: false };
    guildState.set(userId, userState);
    overlayEmitSpeaking(userId, true);
    userState.hasEmittedTrue = true;
  }

  // Clear existing idle timer if any
  if (userState.idleTimer) {
    clearTimeout(userState.idleTimer);
  }

  // Set new idle timer: after AUDIO_SILENCE_THRESHOLD_MS with no packets, emit speaking=false
  userState.idleTimer = setTimeout(() => {
    overlayEmitSpeaking(userId, false);
    guildState.delete(userId);
  }, AUDIO_SILENCE_THRESHOLD_MS);
}

/**
 * Cleanup overlay speaking state when capture ends
 */
function clearOverlaySpeakingState(guildId: string, userId: string) {
  const guildState = overlayUserState.get(guildId);
  if (!guildState) return;

  const userState = guildState.get(userId);
  if (userState) {
    if (userState.idleTimer) {
      clearTimeout(userState.idleTimer);
    }
    // Emit false immediately (finalize is called, so audio is definitely done)
    if (userState.hasEmittedTrue) {
      overlayEmitSpeaking(userId, false);
    }
  }
  guildState.delete(userId);
}

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
      voiceLog.warn(
        `PCM buffer too large (${pcmBuffer.length} bytes), truncating to ${MAX_PCM_BYTES}`
      );
      // Transcribe anyway with truncated buffer (better than failing silently)
    }

    // Convert PCM to WAV and save to disk if enabled
    const pcmToTranscribe = pcmBuffer.length > MAX_PCM_BYTES ? pcmBuffer.subarray(0, MAX_PCM_BYTES) : pcmBuffer;
    const wavBuffer = pcmToWav(pcmToTranscribe, RATE, CHANNELS);
    const audioPath = await saveAudioChunk(guildId, userId, displayName, wavBuffer, cap.startedAt);

    // Transcribe
    const result = await sttProvider.transcribePcm(pcmToTranscribe, RATE);

    const audioMs = cap.totalBytes > 0 ? Math.round((cap.totalBytes / BYTES_PER_SEC) * 1000) : 0;
    const activeMs = cap.activeFrames * FRAME_MS;

    // Discard empty transcriptions silently
    if (!result.text || result.text.trim() === "") {
      return;
    }

    await processTranscribedVoiceText({
      guildId,
      channelId,
      userId,
      displayName,
      text: result.text,
      confidence: result.confidence ?? null,
      sttMeta: result.meta,
      cap,
      audioMs,
      activeMs,
      isBargeIn: cap.isBargeIn,
      audioPath,
    });
  } catch (err) {
    voiceLog.error(`Transcription failed:`, { err });
  }
}

export async function processTranscribedVoiceText(opts: {
  guildId: string;
  channelId: string;
  userId: string;
  displayName: string;
  text: string;
  confidence: number | null;
  sttMeta?: SttTranscriptionMeta;
  cap: Pick<PcmCapture, "startedAt">;
  audioMs: number;
  activeMs: number;
  isBargeIn?: boolean;
  audioPath: string | null;
}): Promise<ClipGateResult> {
  const {
    guildId,
    channelId,
    userId,
    displayName,
    text,
    confidence,
    sttMeta,
    cap,
    audioMs,
    activeMs,
    isBargeIn,
    audioPath,
  } = opts;

  try {
    if (!text || text.trim() === "") {
      return {
        accepted: false,
        reasons: ["empty_text"],
        ratio: audioMs > 0 ? activeMs / audioMs : 0,
      };
    }

    const clipGate = evaluateClipGate({
      audioMs,
      activeMs,
      text,
      meta: sttMeta,
      flags: {
        isBargeIn,
        checkTextGates: true,
      },
    });

    if (!clipGate.accepted) {
      logGateRejection({
        guildId,
        userId,
        reasons: clipGate.reasons,
        audioMs,
        activeMs,
        ratio: clipGate.ratio,
        text,
        meta: sttMeta,
        isBargeIn,
      });
      return clipGate;
    }

    if (isExplicitStopPhrase(text)) {
      voicePlaybackController.abort(guildId, "explicit_stop_phrase", {
        channelId,
        authorId: userId,
        authorName: displayName,
        phrase: text,
        source: "voice",
        logSystemEvent: true,
      });
      return {
        accepted: false,
        reasons: ["explicit_stop_phrase"],
        ratio: clipGate.ratio,
      };
    }

    if (isBlockedSttTranscript(text)) {
      voiceLog.info(`🔕 Discarded blocked STT phrase: "${text}"`);
      return {
        accepted: false,
        reasons: ["blocked_phrase"],
        ratio: clipGate.ratio,
      };
    }

    // Phase 1C: Normalize with registry (for content_norm field)
    const contentNorm = normalizeText(text);

    // Generate unique message ID with random suffix to prevent millisecond collisions
    const randomSuffix = randomBytes(4).toString("hex");
    const messageId = `voice_${userId}_${cap.startedAt}_${randomSuffix}`;

    // Get active session if one exists (for session_id tracking)
    const activeSession = getActiveSession(guildId);

    // Emit to ledger - voice is primary narrative by default
    appendLedgerEntry({
      guild_id: guildId,
      channel_id: channelId,
      message_id: messageId,
      author_id: userId,
      author_name: displayName, // Use member.displayName instead of fallback
      timestamp_ms: Date.now(),
      content: text,      // Raw STT (truth)
      content_norm: contentNorm, // Registry-normalized (Phase 1C)
      tags: "human",
      source: "voice",
      narrative_weight: "primary",
      speaker_id: userId,
      t_start_ms: cap.startedAt,
      t_end_ms: Date.now(),
      confidence,
      audio_chunk_path: audioPath ?? null,
      session_id: activeSession?.session_id ?? null,
    });

    voiceLog.info(
      `📝 Ledger: ${displayName}, text="${text}"${confidence ? `, confidence=${confidence.toFixed(2)}` : ""}`
    );

    // Tier S/A: Per-user latch. S = voice reply, A = text reply.
    const meepo = getActiveMeepo(guildId);
    if (!meepo) return;

    const guildMode = getGuildMode(guildId);
    if (guildMode === "dormant") {
      voiceLog.debug(`🎯 VOICE GATE: guild mode dormant → ignore`);
      return;
    }

    const boundChannelId = meepo.channel_id;
    const personaId = getActivePersonaId(guildId);
    const hasMeepo = hasMeepoInLine(contentNorm, personaId);

    if (isLatchAnchor(contentNorm, personaId)) {
      setLatch(guildId, boundChannelId, userId, DEFAULT_LATCH_SECONDS, DEFAULT_MAX_LATCH_TURNS);
    }
    const latched = isLatchActive(guildId, boundChannelId, userId);

    // Voice when: (1) latch anchor (first word / hey meepo / first 3 words / short line), or (2) latched + name in line.
    const voiceAnchor = isLatchAnchor(contentNorm, personaId);
    const voiceReply = voiceAnchor || (latched && hasMeepo);
    if (voiceReply) {
      const trigger = voiceAnchor ? "wake_phrase" : "mention";
      voiceLog.debug(`🎯 VOICE GATE: ${voiceAnchor ? "anchor" : "latched+hasMeepo"} → voice reply (Tier S)`);
      respondToVoiceUtterance({
        guildId,
        channelId,
        speakerId: userId,
        speakerName: displayName,
        utterance: contentNorm,
        textChannelId: boundChannelId,
        replyViaTextOnly: false,
        tier: "S",
        trigger,
      }).catch((err) => {
        voiceLog.error(`VoiceReply unhandled error:`, { err });
      });
    } else if (hasMeepo) {
      voiceLog.debug(`🎯 VOICE GATE: hasMeepo, not latched → text reply (Tier A)`);
      respondToVoiceUtterance({
        guildId,
        channelId,
        speakerId: userId,
        speakerName: displayName,
        utterance: contentNorm,
        textChannelId: boundChannelId,
        replyViaTextOnly: true,
        tier: "A",
        trigger: "name_mention",
      }).catch((err) => {
        voiceLog.error(`VoiceReply unhandled error:`, { err });
      });
    } else if (latched) {
      voiceLog.debug(`🎯 VOICE GATE: latched, no Meepo in line → text reply (Tier A)`);
      respondToVoiceUtterance({
        guildId,
        channelId,
        speakerId: userId,
        speakerName: displayName,
        utterance: contentNorm,
        textChannelId: boundChannelId,
        replyViaTextOnly: true,
        tier: "A",
        trigger: "latched_followup",
      }).catch((err) => {
        voiceLog.error(`VoiceReply unhandled error:`, { err });
      });
    } else {
      voiceLog.debug(`🎯 VOICE GATE: not latched, no Meepo → ignore`);
    }

    return clipGate;
  } catch (err) {
    voiceLog.error(`Transcribed text handling failed:`, { err });
    return {
      accepted: false,
      reasons: ["handler_error"],
      ratio: audioMs > 0 ? activeMs / audioMs : 0,
    };
  }
}

export function startReceiver(guildId: string): void {
  const state = getVoiceState(guildId);
  if (!state) {
    voiceLog.warn(`No voice state`);
    return;
  }
  if (!state.sttEnabled) {
    voiceLog.warn(`STT not enabled`);
    return;
  }

  // Idempotent: don't register twice
  if (receiverHandlers.has(guildId)) {
    voiceLog.debug(`Receiver already active`);
    return;
  }

  const connection = state.connection;
  const channelId = state.channelId;
  const channelName = state.guild.channels.cache.get(channelId)?.name ?? "unknown";

  if (!activeSpeakers.has(guildId)) activeSpeakers.set(guildId, new Map());
  if (!pcmCaptures.has(guildId)) pcmCaptures.set(guildId, new Map());
  if (!userCooldowns.has(guildId)) userCooldowns.set(guildId, new Map());

  voiceLog.info(`Starting receiver for channel #${channelName}`);

  const onStart = async (userId: string) => {
    const speakers = activeSpeakers.get(guildId);
    const captures = pcmCaptures.get(guildId);
    if (!speakers || !captures) return;

    // Prevent duplicate subscriptions if Discord fires "start" repeatedly
    if (captures.has(userId)) {
      voiceLog.debug(`(dup start ignored) userId=${userId}`);
      return;
    }

    const bargeInTriggered = voicePlaybackController.onUserSpeechStart(guildId, {
      channelId,
      authorId: userId,
      source: "voice",
      logSystemEvent: true,
    });

    // Fetch fresh member data for display name
    let displayName = `User_${userId.slice(0, 8)}`;
    try {
      if (state.guild) {
        const member = await state.guild.members.fetch(userId);
        displayName = member.displayName ?? member.user?.username ?? displayName;
      }
    } catch (err: any) {
      voiceLog.debug(`Could not fetch member display name for ${userId}:`, { error: err.message });
      // displayName stays as fallback
    }

    const startedAt = Date.now();
    speakers.set(userId, { userId, guildId, channelId, startedAt });

    voiceLog.debug(
      `🎤 Speaking started: ${displayName} (${userId}), guild=${guildId}, channel=${channelId}`
    );

    // Create a capture record first
    captures.set(userId, {
      userId,
      displayName,
      pcmChunks: [],
      totalBytes: 0,
      startedAt,
      isBargeIn: bargeInTriggered,
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

      // Update overlay speaking activity (emits true on first packet, resets idle timer)
      updateOverlaySpeakingActivity(guildId, userId);

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
      const baseGate = evaluateClipGate({
        audioMs,
        activeMs,
        flags: {
          isBargeIn: cap.isBargeIn,
          checkTextGates: false,
        },
      });

      let shouldAccept = baseGate.accepted;
      const gateReasons = [...baseGate.reasons];

      // Gate 3: per-user cooldown
      if (shouldAccept) {
        const cooldowns = userCooldowns.get(guildId);
        if (cooldowns) {
          const lastAccepted = cooldowns.get(userId) ?? 0;
          const since = now - lastAccepted;
          if (since < USER_COOLDOWN_MS) {
            shouldAccept = false;
            gateReasons.push(`cooldown:${since}ms<${USER_COOLDOWN_MS}ms`);
          }
        }
      }

      try {
        if (shouldAccept) {
          userCooldowns.get(guildId)?.set(userId, now);
          voiceLog.info(
            `🔇 Speaking ended: ${cap.displayName} (${userId}), wallClockMs=${wallClockMs}, pcmBytes=${cap.totalBytes}, audioMs=${audioMs}, activeMs=${activeMs}, peak=${cap.peak}`
          );

          // Queue transcription via promise chain (ensures serial, FIFO execution per guild)
          const currentChain = guildSttChain.get(guildId) ?? Promise.resolve();
          const newChain = currentChain
            .then(() => handleTranscription(guildId, channelId, userId, cap.displayName, cap))
            .catch((err) => {
              voiceLog.error(`handleTranscription error for userId=${userId}:`, { err });
            });
          guildSttChain.set(guildId, newChain);
        } else {
          logGateRejection({
            guildId,
            userId,
            reasons: gateReasons,
            audioMs,
            activeMs,
            ratio: baseGate.ratio,
            isBargeIn: cap.isBargeIn,
          });
        }

        if (err) {
          voiceLog.debug(`finalize reason=${reason} userId=${userId}`, { err });
        }
      } finally {
        // Cleanup overlay speaking state
        clearOverlaySpeakingState(guildId, userId);

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
    voiceLog.debug(`No voice state for guild ${guildId}, nothing to stop`);
    return;
  }

  voiceLog.info(`Stopping receiver for guild ${guildId}`);

  const handlers = receiverHandlers.get(guildId);
  if (handlers) {
    state.connection.receiver.speaking.off("start", handlers.onStart);
    state.connection.receiver.speaking.off("end", handlers.onEnd);
    receiverHandlers.delete(guildId);
  } else {
    // Fallback: no known handlers; avoid nuking other listeners unexpectedly
    voiceLog.debug(`No handler record for guild ${guildId}`);
  }

  activeSpeakers.get(guildId)?.clear();
  activeSpeakers.delete(guildId);

  pcmCaptures.get(guildId)?.clear();
  pcmCaptures.delete(guildId);

  userCooldowns.get(guildId)?.clear();
  userCooldowns.delete(guildId);

  // Clean up overlay speaking state for all users in this guild
  const guildState = overlayUserState.get(guildId);
  if (guildState) {
    guildState.forEach((userState, userId) => {
      if (userState.idleTimer) {
        clearTimeout(userState.idleTimer);
      }
      // Ensure overlay clients are notified this user is no longer speaking
      overlayEmitSpeaking(userId, false);
    });
    overlayUserState.delete(guildId);
  }
}

export function isReceiverActive(guildId: string): boolean {
  return receiverHandlers.has(guildId);
}
