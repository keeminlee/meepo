/**
 * Voice Reply Handler (Task 4.6)
 *
 * Generates and speaks a reply when Meepo is addressed in voice.
 *
 * Flow:
 * 1. Check preconditions (in voice, not speaking, cooldown passed)
 * 2. Pull recent context from ledger
 * 3. Build system prompt with persona
 * 4. Call LLM to generate response5. TTS synthesize and queue playback
 * 6. Log as system event
 */

import { getActiveMeepo } from "../meepo/state.js";
import { getVoiceState } from "./state.js";
import { isMeepoSpeaking, speakInGuild } from "./speaker.js";
import { getTtsProvider } from "./tts/provider.js";
import { buildMeepoPrompt, buildUserMessage } from "../llm/prompts.js";
import { chat } from "../llm/client.js";
import { getLedgerInRange } from "../ledger/ledger.js";
import { logSystemEvent } from "../ledger/system.js";

const DEBUG_VOICE = process.env.DEBUG_VOICE === "true";

// Per-guild voice reply cooldown (prevents rapid-fire replies)
const guildLastVoiceReply = new Map<string, number>();

/**
 * Generate and speak a reply to a voice utterance.
 *
 * @param guildId Guild ID
 * @param channelId Channel ID
 * @param speakerName Display name of speaker (from Discord)
 * @param utterance The transcribed voice input
 * @returns true if reply was generated and queued, false if preconditions failed
 */
export async function respondToVoiceUtterance({
  guildId,
  channelId,
  speakerName,
  utterance,
}: {
  guildId: string;
  channelId: string;
  speakerName: string;
  utterance: string;
}): Promise<boolean> {
  // Precondition 1: Meepo must be awake
  const active = getActiveMeepo(guildId);
  if (!active) {
    if (DEBUG_VOICE) console.log(`[VoiceReply] Meepo asleep, skipping voice reply`);
    return false;
  }

  // Precondition 2: Meepo must be in voice channel
  const voiceState = getVoiceState(guildId);
  if (!voiceState) {
    if (DEBUG_VOICE) console.log(`[VoiceReply] Not in voice, skipping voice reply`);
    return false;
  }

  // Precondition 3: Meepo must not be speaking (feedback loop protection)
  if (isMeepoSpeaking(guildId)) {
    if (DEBUG_VOICE) console.log(`[VoiceReply] Meepo speaking, skipping voice reply`);
    return false;
  }

  // Precondition 4: Cooldown must have passed
  const now = Date.now();
  const cooldownMs = Number(process.env.VOICE_REPLY_COOLDOWN_MS ?? "5000");
  const lastReply = guildLastVoiceReply.get(guildId) ?? 0;
  const timeSinceLastReply = now - lastReply;

  if (timeSinceLastReply < cooldownMs) {
    if (DEBUG_VOICE) {
      console.log(
        `[VoiceReply] Cooldown active (${timeSinceLastReply}ms / ${cooldownMs}ms), skipping`
      );
    }
    return false;
  }

  // Update cooldown
  guildLastVoiceReply.set(guildId, now);

  try {
    // Pull context from ledger (primary-only, last LLM_VOICE_CONTEXT_MS)
    const contextWindowMs = Number(process.env.LLM_VOICE_CONTEXT_MS ?? "120000"); // 120s default
    const startMs = now - contextWindowMs;
    
    const entries = getLedgerInRange({
      guildId,
      startMs,
      endMs: now,
      limit: 20,
      primaryOnly: true,
    });

    // Format context from ledger entries
    const recentContext = entries
      .map((e) => {
        const t = new Date(e.timestamp_ms).toISOString();
        return `[${t}] ${e.author_name}: ${e.content}`;
      })
      .join("\n");

    // Build system prompt with persona
    const systemPrompt = buildMeepoPrompt({
      meepo: active,
      recentContext: recentContext || undefined,
    });

    // Build user message
    const userMessage = buildUserMessage({
      authorName: speakerName,
      content: utterance,
    });

    // Call LLM to generate response (shorter tokens for voice)
    const responseText = await chat({
      systemPrompt,
      userMessage,
      maxTokens: 100, // Shorter responses for voice
    });

    if (DEBUG_VOICE) {
      console.log(`[VoiceReply] LLM response: "${responseText.substring(0, 50)}..."`);
    }

    // TTS synthesize
    const ttsProvider = await getTtsProvider();
    const mp3Buffer = await ttsProvider.synthesize(responseText);

    if (mp3Buffer.length === 0) {
      console.warn(`[VoiceReply] TTS returned empty buffer`);
      return false;
    }

    // Queue playback
    speakInGuild(guildId, mp3Buffer, {
      userDisplayName: "[voice-reply]",
    });

    // Log as system event
    logSystemEvent({
      guildId,
      channelId,
      eventType: "voice_reply",
      content: responseText,
      authorId: "system",
      authorName: "Meepo",
    });

    console.log(`[VoiceReply] Generated and queued reply for guild ${guildId}`);
    return true;
  } catch (err: any) {
    console.error(`[VoiceReply] Error generating reply:`, err.message ?? err);
    return false;
  }
}
