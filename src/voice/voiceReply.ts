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
import { getActivePersonaId, getMindspace } from "../meepo/personaState.js";
import { log } from "../utils/logger.js";
import { getVoiceState } from "./state.js";
import { isMeepoSpeaking, speakInGuild } from "./speaker.js";
import { getTtsProvider } from "./tts/provider.js";
import { buildMeepoPrompt, buildUserMessage } from "../llm/prompts.js";
import { chat } from "../llm/client.js";
import { getLedgerInRange, getVoiceAwareContext } from "../ledger/ledger.js";
import { getSanitizedSpeakerName } from "../ledger/speakerSanitizer.js";
import { logSystemEvent } from "../ledger/system.js";
import { applyPostTtsFx } from "./audioFx.js";
import { getDiscordClient } from "../bot.js";
import { getActiveSession } from "../sessions/sessions.js";
import { logConvoTurn } from "../ledger/meepoConvo.js";
import { buildConvoTailContext } from "../recall/buildConvoTailContext.js";
import { appendLedgerEntry } from "../ledger/ledger.js";
import type { TextChannel } from "discord.js";
import { loadRegistry } from "../registry/loadRegistry.js";
import { extractRegistryMatches } from "../registry/extractRegistryMatches.js";
import { searchEventsByTitleScoped, type EventRow } from "../ledger/eventSearch.js";
import { loadGptcap } from "../ledger/gptcapProvider.js";
import { findRelevantBeats, type ScoredBeat } from "../recall/findRelevantBeats.js";
import { buildMemoryContext } from "../recall/buildMemoryContext.js";
import { getTranscriptLines } from "../ledger/transcripts.js";
import { getDbForCampaign } from "../db.js";
import { resolveCampaignSlug } from "../campaign/guildConfig.js";
import { randomUUID } from "node:crypto";
import { incrementLatchTurn } from "../latch/latch.js";
import { recordMeepoInteraction, trimToSnippet, classifyTrigger } from "../ledger/meepoInteractions.js";
import { buildTranscript } from "../ledger/transcripts.js";
import { cfg } from "../config/env.js";

const voiceReplyLog = log.withScope("voice-reply");
const DEBUG_VOICE = cfg.logging.level === "debug" || cfg.logging.level === "trace";
let warnedMissingRegistryForVoiceMemory = false;

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
export async function respondToVoiceUtterance(
  opts: {
    guildId: string;
    channelId: string;
    speakerId: string;
    speakerName: string;
    utterance: string;
    /** When set, text replies (reply_mode=text or replyViaTextOnly) post to this channel (bound text channel). */
    textChannelId?: string;
    /** When true, skip TTS and post response as text only (never forces voice when false). */
    replyViaTextOnly?: boolean;
    /** Tier S (direct) or A (mention) for meepo_interactions. */
    tier?: "S" | "A";
    /** Trigger type for meepo_interactions. */
    trigger?: "wake_phrase" | "name_mention" | "mention" | "latched_followup";
  }
): Promise<boolean> {
  const { guildId, channelId, speakerId, speakerName, utterance, textChannelId, replyViaTextOnly, tier: tierFromCaller, trigger } = opts;
  const latchChannelId = textChannelId ?? channelId;
  // Precondition 1: Meepo must be awake
  const active = getActiveMeepo(guildId);
  if (!active) {
    if (DEBUG_VOICE) voiceReplyLog.debug(`Meepo asleep, skipping voice reply`);
    return false;
  }

  // Precondition 2: Meepo must be in voice channel
  const voiceState = getVoiceState(guildId);
  if (!voiceState) {
    if (DEBUG_VOICE) voiceReplyLog.debug(`Not in voice, skipping voice reply`);
    return false;
  }

  // Precondition 3: Meepo must not be speaking (feedback loop protection)
  if (isMeepoSpeaking(guildId)) {
    if (DEBUG_VOICE) voiceReplyLog.debug(`Meepo speaking, skipping voice reply`);
    return false;
  }

  // Precondition 4: Cooldown must have passed
  const now = Date.now();
  const campaignSlug = resolveCampaignSlug({ guildId });
  const cooldownMs = cfg.voice.replyCooldownMs;
  const lastReply = guildLastVoiceReply.get(guildId) ?? 0;
  const timeSinceLastReply = now - lastReply;

  if (timeSinceLastReply < cooldownMs) {
    if (DEBUG_VOICE) {
      voiceReplyLog.debug(
        `Cooldown active (${timeSinceLastReply}ms / ${cooldownMs}ms), skipping`
      );
    }
    return false;
  }

  // Update cooldown
  guildLastVoiceReply.set(guildId, now);

  try {
    // Task 4.7: Use shared voice-aware context function
    const { context: recentContext, hasVoice } = getVoiceAwareContext({
      guildId,
      channelId,
    });

    // Task 9: Run recall pipeline for party memory injection
    let partyMemory = "";
    const memoryEnabled = cfg.features.memoryEnabled;
    
    if (memoryEnabled) {
      try {
        const registry = loadRegistry({ campaignSlug });
        const matches = extractRegistryMatches(utterance, registry);
        
        voiceReplyLog.debug(`Voice - Registry matches: ${matches.length} [${matches.map(m => m.canonical).join(", ")}]`);

        if (matches.length > 0) {
          // Search for events using registry matches
          const allEvents = new Map<string, EventRow>();
          for (const match of matches) {
            const events = searchEventsByTitleScoped({ term: match.canonical, guildId });
            voiceReplyLog.debug(`Voice - Events for "${match.canonical}": ${events.length}`);
            for (const event of events) {
              allEvents.set(event.event_id, event);
            }
          }

          if (allEvents.size > 0) {
            // Group events by session
            const eventsBySession = new Map<string, EventRow[]>();
            for (const event of allEvents.values()) {
              const existing = eventsBySession.get(event.session_id) || [];
              existing.push(event);
              eventsBySession.set(event.session_id, existing);
            }

            // Load GPTcaps and find relevant beats per session
            const allBeats: ScoredBeat[] = [];
            const db = getDbForCampaign(campaignSlug);

            for (const [sessionId, sessionEvents] of eventsBySession.entries()) {
              // Get session label for GPTcap loading
              const labelRow = db.prepare("SELECT label FROM sessions WHERE session_id = ? LIMIT 1")
                .get(sessionId) as { label: string | null } | undefined;
              const label = labelRow?.label;

              if (label) {
                const gptcap = loadGptcap(label);
                if (gptcap) {
                  const relevantBeats = findRelevantBeats(gptcap, sessionEvents, { topK: 6 });
                  allBeats.push(...relevantBeats);
                }
              }
            }

            // Build memory context if we have beats
            if (allBeats.length > 0) {
              // Collect all needed transcript lines from beats
              const linesBySession = new Map<string, Set<number>>();
              for (const scored of allBeats) {
                // Find which session this beat belongs to (via events)
                for (const [sessionId, sessionEvents] of eventsBySession.entries()) {
                  // Simple heuristic: if any event overlaps with beat lines, associate beat with this session
                  const hasOverlap = sessionEvents.some(event => {
                    if (typeof event.start_line !== "number" || typeof event.end_line !== "number") {
                      return false;
                    }
                    const eventLines = new Set<number>();
                    for (let i = event.start_line; i <= event.end_line; i++) {
                      eventLines.add(i);
                    }
                    return scored.beat.lines.some(line => eventLines.has(line));
                  });

                  if (hasOverlap) {
                    const lines = linesBySession.get(sessionId) || new Set<number>();
                    for (const line of scored.beat.lines) {
                      lines.add(line);
                    }
                    linesBySession.set(sessionId, lines);
                    break; // Associate beat with first matching session
                  }
                }
              }

              // Fetch transcript lines (use first session with lines for now)
              const firstSessionWithLines = Array.from(linesBySession.keys())[0];
              if (firstSessionWithLines) {
                const neededLines = Array.from(linesBySession.get(firstSessionWithLines) || []);
                if (neededLines.length > 0) {
                  const transcriptLines = getTranscriptLines(firstSessionWithLines, neededLines, { db });
                  partyMemory = buildMemoryContext(allBeats, transcriptLines, {
                    maxLinesPerBeat: 2,
                    maxTotalChars: 1600,
                  });
                }
              }
            }
          }
        }
      } catch (recallErr: any) {
        const message = recallErr?.message ?? String(recallErr);
        if (message.includes("Registry directory not found")) {
          if (!warnedMissingRegistryForVoiceMemory) {
            warnedMissingRegistryForVoiceMemory = true;
            voiceReplyLog.warn(
              `Memory retrieval disabled (voice): registry not found on this device. Continuing without party memory.`
            );
          }
        } else {
          voiceReplyLog.warn(`Memory retrieval failed (voice): ${message}`);
        }
        // Continue without memory context on error
      }
    }

    // Layer 0: Build conversation tail context (session-scoped)
    const activeSession = getActiveSession(guildId);
    const { tailBlock } = buildConvoTailContext(activeSession?.session_id ?? null, guildId);

    const personaId = getActivePersonaId(guildId);
    const mindspace = getMindspace(guildId, personaId);

    if (mindspace === null) {
      if (DEBUG_VOICE) voiceReplyLog.debug("Campaign persona with no session, skipping voice reply");
      return false;
    }

    const promptResult = await buildMeepoPrompt({
      personaId,
      mindspace,
      meepo: active,
      recentContext: recentContext || undefined,
      hasVoiceContext: hasVoice,
      partyMemory,
      convoTail: tailBlock || undefined,
      guildId,
      sessionId: activeSession?.session_id ?? null,
      speakerId,
    });

    voiceReplyLog.debug(
      `persona_id=${promptResult.personaId} mindspace=${promptResult.mindspace ?? "n/a"} memory_refs=${promptResult.memoryRefs.length}`
    );

    // Build user message with sanitized speaker name
    const sanitizedSpeakerName = getSanitizedSpeakerName(guildId, speakerId, speakerName);
    const userMessage = buildUserMessage({
      authorName: sanitizedSpeakerName,
      content: utterance,
    });

    // Layer 0: Log player utterance before LLM call
    if (activeSession) {
      logConvoTurn({
        guild_id: guildId,
        session_id: activeSession.session_id,
        channel_id: channelId,
        message_id: null, // Voice has no Discord message_id
        speaker_id: speakerId,
        speaker_name: sanitizedSpeakerName,
        role: "player",
        content_raw: utterance,
      });
    }

    // Call LLM to generate response (shorter tokens for voice)
    const responseText = await chat({
      systemPrompt: promptResult.systemPrompt,
      userMessage,
      maxTokens: 100, // Shorter responses for voice
    });

    const db = getDbForCampaign(campaignSlug);
    db.prepare(`
      INSERT INTO meep_usages (id, session_id, message_id, guild_id, channel_id, triggered_at_ms, response_tokens, used_memories, persona_id, mindspace, created_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      activeSession?.session_id ?? null,
      `voice:${now}`,
      guildId,
      channelId,
      now,
      null,
      JSON.stringify(promptResult.memoryRefs),
      promptResult.personaId,
      promptResult.mindspace ?? null,
      Date.now()
    );

    // Tier S/A: tier = reply channel (S voice, A text); record after we know sendAsText
    const resolvedTrigger = tierFromCaller && trigger ? classifyTrigger(utterance, trigger) : trigger;
    const sendAsTextForRecord = active.reply_mode === "text" || replyViaTextOnly === true;
    const tierForRecord = sendAsTextForRecord ? "A" : "S";
    const replyModeForRecord = sendAsTextForRecord ? "text" : "voice";
    if (resolvedTrigger) {
      let startLineIndex: number | null = null;
      let endLineIndex: number | null = null;
      if (activeSession?.session_id) {
        try {
          const transcript = buildTranscript(activeSession.session_id, true, db);
          const lastLine = transcript.length - 1;
          if (lastLine >= 0) {
            startLineIndex = lastLine;
            endLineIndex = lastLine;
          }
        } catch {
          // No transcript yet; snippet will fallback
        }
      }
      recordMeepoInteraction({
        guildId,
        sessionId: activeSession?.session_id ?? null,
        personaId: promptResult.personaId,
        tier: tierForRecord,
        trigger: resolvedTrigger,
        speakerId,
        startLineIndex,
        endLineIndex,
        meta: {
          voice_reply_content_snippet: trimToSnippet(responseText),
          reply_mode: replyModeForRecord,
          latch_state: "latched",
          latch_key: `${guildId}:${latchChannelId}:${speakerId}`,
        },
      });
    }

    // Layer 0: Log Meepo's response after LLM call
    if (activeSession) {
      logConvoTurn({
        guild_id: guildId,
        session_id: activeSession.session_id,
        channel_id: channelId,
        message_id: null, // Voice has no Discord message_id
        speaker_id: getDiscordClient().user?.id ?? null,
        speaker_name: "Meepo",
        role: "meepo",
        content_raw: responseText,
      });
    }

    if (DEBUG_VOICE) {
      voiceReplyLog.debug(`LLM response: "${responseText.substring(0, 50)}..."`);
    }

    const targetTextChannelId = textChannelId ?? channelId;
    const sendAsText = active.reply_mode === "text" || replyViaTextOnly === true;

    // Increment latch turn only when we actually reply (per-user)
    incrementLatchTurn(guildId, latchChannelId, speakerId);

    if (sendAsText && targetTextChannelId) {
      // Send text reply to bound (text) channel
      try {
        const client = getDiscordClient();
        const channel = await client.channels.fetch(targetTextChannelId) as TextChannel;

        if (channel?.isTextBased()) {
          const reply = await channel.send(responseText);
          
          // Log bot's reply to ledger (preserve voice narrative weight even in text mode)
          appendLedgerEntry({
            guild_id: guildId,
            channel_id: targetTextChannelId,
            message_id: reply.id,
            author_id: client.user!.id,
            author_name: client.user!.username,
            timestamp_ms: reply.createdTimestamp,
            content: responseText,
            tags: "npc,meepo,spoken",
            source: "voice",
            narrative_weight: "primary",
          });
          
          voiceReplyLog.info(`Sent text reply (mode=text): "${responseText}"`);
          return true;
        }
      } catch (err: any) {
        voiceReplyLog.error(`Error sending text reply: ${err.message ?? err}`);
        return false;
      }
    }

    // TTS synthesize
    const ttsProvider = await getTtsProvider();
    let mp3Buffer = await ttsProvider.synthesize(responseText);

    if (mp3Buffer.length === 0) {
      voiceReplyLog.warn(`TTS returned empty buffer`);
      return false;
    }

    // Apply post-TTS audio effects (if enabled)
    mp3Buffer = await applyPostTtsFx(mp3Buffer, "mp3");

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

    voiceReplyLog.info(`🔊 Meepo: "${responseText}"`);
    return true;
  } catch (err: any) {
    voiceReplyLog.error(`Error generating reply: ${err.message ?? err}`);
    return false;
  }
}
