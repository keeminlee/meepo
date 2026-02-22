import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { log } from "./utils/logger.js";
import { registerHandlers } from "./commands/index.js";
import { getActiveMeepo, wakeMeepo, transformMeepo } from "./meepo/state.js";
import { getActivePersonaId, getMindspace, setActivePersonaId } from "./meepo/personaState.js";
import { autoJoinGeneralVoice } from "./meepo/autoJoinVoice.js";
import { startAutoSleepChecker } from "./meepo/autoSleep.js";
import { getActiveSession } from "./sessions/sessions.js";
import { appendLedgerEntry, getVoiceAwareContext } from "./ledger/ledger.js";
import { getSanitizedSpeakerName } from "./ledger/speakerSanitizer.js";
import { logConvoTurn } from "./ledger/meepoConvo.js";
import { buildConvoTailContext } from "./recall/buildConvoTailContext.js";
import { isAddressed } from "./meepo/triggers.js";
import { chat } from "./llm/client.js";
import { buildMeepoPrompt, buildUserMessage } from "./llm/prompts.js";
import { setBotNicknameForPersona } from "./meepo/nickname.js";
import { acquireLock } from "./pidlock.js";
import { seedMeepoMemories } from "./db.js";
import { loadRegistry } from "./registry/loadRegistry.js";
import { extractRegistryMatches } from "./registry/extractRegistryMatches.js";
import { searchEventsByTitle, type EventRow } from "./ledger/eventSearch.js";
import { loadGptcap } from "./ledger/gptcapProvider.js";
import { findRelevantBeats, type ScoredBeat } from "./recall/findRelevantBeats.js";
import { buildMemoryContext } from "./recall/buildMemoryContext.js";
import { getTranscriptLines } from "./ledger/transcripts.js";
import { getDb } from "./db.js";
import { randomUUID } from "node:crypto";
import { startOverlayServer, overlayEmitPresence } from "./overlay/server.js";
import { joinVoice } from "./voice/connection.js";
import { startReceiver } from "./voice/receiver.js";
import { setVoiceState } from "./voice/state.js";

const bootLog = log.withScope("boot");
const overlayLog = log.withScope("overlay");
const textReplyLog = log.withScope("text-reply");
const recallLog = log.withScope("recall");

// PID lock: prevent multiple instances
if (!acquireLock()) {
  process.exit(1);
}

// Start overlay server early (independent of Discord)
await startOverlayServer();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates, // Required for voice channel detection
  ],
});

// Export client for use in voice reply handler
export function getDiscordClient(): Client {
  return client;
}

registerHandlers(client);

client.once("ready", async () => {
  bootLog.info(`Meepo online as ${client.user?.tag ?? "<unknown>"}`);
  
  // Initialize MeepoMind (seed foundational memories on first run)
  try {
    await seedMeepoMemories();
  } catch (err: any) {
    bootLog.error(`Failed to seed MeepoMind: ${err.message ?? err}`);
  }

  // Validate announcement channel configuration
  const announcementChannelId = process.env.ANNOUNCEMENT_CHANNEL_ID;
  if (announcementChannelId) {
    bootLog.info(`Announcement channel configured: ${announcementChannelId}`);
  } else {
    bootLog.warn(`ANNOUNCEMENT_CHANNEL_ID not set. /meepo announce will reply with error.`);
  }

  // Restore Meepo active state (if Meepo was active before shutdown)
  const guildId = process.env.GUILD_ID;
  if (guildId) {
    const activeMeepo = getActiveMeepo(guildId);
    if (activeMeepo) {
      bootLog.info(`Meepo restored: form=${activeMeepo.form_id}, channel=${activeMeepo.channel_id}, session continues`);
      
      // Auto-join General voice on redeploy (resume listening)
      try {
        await autoJoinGeneralVoice({
          client,
          guildId,
          channelId: activeMeepo.channel_id,
        });
      } catch (err: any) {
        bootLog.warn(`Failed to auto-join voice on restore: ${err.message ?? err}`);
      }
    }
  }

  // Start auto-sleep checker for inactive Meepo instances
  startAutoSleepChecker();

  // Auto-join overlay voice channel (for speaking detection, independent of Meepo sessions)
  // Configurable via OVERLAY_AUTOJOIN=true (disabled by default)
  const overlayVoiceChannelId = process.env.OVERLAY_VOICE_CHANNEL_ID;
  const overlayAutoJoinEnabled = process.env.OVERLAY_AUTOJOIN === "true";
  
  if (overlayAutoJoinEnabled && guildId && overlayVoiceChannelId) {
    try {
      const guild = await client.guilds.fetch(guildId);
      const channel = await guild.channels.fetch(overlayVoiceChannelId);
      
      if (!channel || !channel.isVoiceBased()) {
        overlayLog.warn(`Channel ${overlayVoiceChannelId} is not a voice channel`);
        return;
      }

      const connection = await joinVoice({
        guildId,
        channelId: overlayVoiceChannelId,
        adapterCreator: guild.voiceAdapterCreator,
      });

      // Set voice state with STT enabled for overlay channel
      setVoiceState(guildId, {
        channelId: overlayVoiceChannelId,
        connection,
        guild,
        sttEnabled: true, // ← Enable STT for overlay speaking detection
        connectedAt: Date.now(),
      });

      startReceiver(guildId);

      // Set initial presence for users already in the channel
      if (channel.isVoiceBased()) {
        channel.members.forEach((member) => {
          overlayEmitPresence(member.id, true);
          overlayLog.debug(`Initial presence: ${member.displayName} (${member.id})`);
        });
      }

      // Set Meepo's presence (bot is in voice)
      overlayEmitPresence("meepo", true);
      overlayLog.debug(`Set Meepo presence: true`);

      overlayLog.info(`Auto-joined voice channel and listening for speaking events`);
    } catch (err: any) {
      overlayLog.error(`Failed to auto-join voice channel: ${err.message ?? err}`);
    }
  }
});

// Track voice channel presence for overlay (who's in voice)
client.on("voiceStateUpdate", (oldState, newState) => {
  const overlayChannelId = process.env.OVERLAY_VOICE_CHANNEL_ID;
  if (!overlayChannelId) return;

  const userId = newState.id;
  const wasInOverlayChannel = oldState.channelId === overlayChannelId;
  const isInOverlayChannel = newState.channelId === overlayChannelId;

  // User joined the overlay voice channel (from any state)
  if (isInOverlayChannel && !wasInOverlayChannel) {
    overlayEmitPresence(userId, true);
    overlayLog.debug(`User ${userId} joined voice channel`);
  }
  // User left the overlay voice channel (to any state)
  else if (!isInOverlayChannel && wasInOverlayChannel) {
    overlayEmitPresence(userId, false);
    overlayLog.debug(`User ${userId} left voice channel`);
  }
});

client.on("messageCreate", async (message: any) => {
  try {
    const authorDisplayName = message.member?.displayName ?? message.author.username ?? message.author.id;
    log.debug(`Message: ${authorDisplayName} in ${message.channelId}`, "boot", { content: message.content });
    if (!message.guildId) return;
    
    // Response gate: Never respond to bot's own messages (prevents re-entrancy)
    if (message.author?.bot) return;

    const content = (message.content ?? "").toString();
    if (!content.trim()) return;

    // Get active session if one exists (for session_id tracking)
    const activeSession = getActiveSession(message.guildId);

    // 1) LEDGER: log every message in the guild that Meepo can see
    appendLedgerEntry({
      guild_id: message.guildId,
      channel_id: message.channelId,
      message_id: message.id,
      author_id: message.author.id,
      author_name: message.member?.displayName ?? message.author.username ?? message.author.id,
      timestamp_ms: message.createdTimestamp ?? Date.now(),
      content,
      tags: "human",
      session_id: activeSession?.session_id ?? null,
    });

    // 2) WAKE-ON-NAME: Auto-wake Meepo if message contains "meepo" and Meepo is not active
    let active = getActiveMeepo(message.guildId);
    const contentLower = content.toLowerCase();
    
    // console.log("WAKE CHECK:", {
    //   hasActive: !!active,
    //   contentLower,
    //   containsMeepo: contentLower.includes("meepo"),
    // });
    
    if (!active && contentLower.includes("meepo")) {
      bootLog.info(`AUTO-WAKE triggered by ${message.author.username} in channel ${message.channelId}`);
      
      // Wake Meepo and bind to this channel
      active = wakeMeepo({
        guildId: message.guildId,
        channelId: message.channelId,
        personaSeed: null,
      });

      // Reset nickname to default Meepo
      const guild = client.guilds.cache.get(message.guildId);
      if (guild) {
        await setBotNicknameForPersona(guild, "meepo");
      }
      
      // Auto-join General voice channel on wake
      await autoJoinGeneralVoice({
        client,
        guildId: message.guildId,
        channelId: message.channelId,
      });
      
      // console.log("WAKE RESULT:", active);

      // Log the auto-wake action
      appendLedgerEntry({
        guild_id: message.guildId,
        channel_id: message.channelId,
        message_id: `system:wake:${Date.now()}`,
        author_id: "system",
        author_name: "SYSTEM",
        timestamp_ms: Date.now(),
        content: `Auto-wake triggered by text containing "meepo".`,
        tags: "system,action,wake",
      });

      // Persona Overhaul v1: default to Meta Meepo on wake
      setActivePersonaId(message.guildId, "meta_meepo");

      // Continue processing to respond to the wake message
    }

    // If still no active Meepo, nothing more to do
    if (!active) return;

    // console.log("ACTIVE MEEPO:", {
    //   id: active.id,
    //   form_id: active.form_id,
    //   persona_seed: active.persona_seed,
    // });


    // 3.5) COMMAND-LESS TRANSFORM: Check for natural language transform triggers
    const lowerContent = contentLower; // Already computed earlier
    let transformTarget: string | null = null;

    // Check for transform to Xoblob
    if (
      lowerContent.includes("xoblob") &&
      (lowerContent.includes("transform") ||
        lowerContent.includes("become") ||
        lowerContent.includes("turn into") ||
        lowerContent.includes("switch") ||
        lowerContent.includes("come out") ||
        lowerContent.startsWith("xoblob"))
    ) {
      transformTarget = "xoblob";
    }
    // Check for transform back to Meepo
    else if (
      (lowerContent.includes("meepo") &&
        (lowerContent.includes("turn back") ||
          lowerContent.includes("back") ||
          lowerContent.includes("again") ||
          lowerContent.includes("transform") ||
          lowerContent.includes("become") ||
          lowerContent.includes("switch"))) ||
      lowerContent.includes("back to meepo") ||
      lowerContent.includes("regular meepo") ||
      lowerContent.includes("normal meepo")
    ) {
      transformTarget = "meepo";
    }

    // If transform detected
    if (transformTarget) {
      // Already in target form - acknowledge without re-transforming
      if (transformTarget === active.form_id) {
        bootLog.debug(`Already in form ${transformTarget} - acknowledging without transform`);
        
        let ackMessage: string;
        if (transformTarget === "xoblob") {
          ackMessage = "... can't unwrap what's already unwrapped... Xoblob IS Xoblob IS Xoblob... *eight legs tapping*...";
        } else {
          ackMessage = "Meepo is Meepo, meep!";
        }
        
        const reply = await message.reply(ackMessage);
        
        // Log bot's acknowledgement
        appendLedgerEntry({
          guild_id: message.guildId,
          channel_id: message.channelId,
          message_id: reply.id,
          author_id: client.user!.id,
          author_name: client.user!.username,
          timestamp_ms: reply.createdTimestamp,
          content: ackMessage,
          tags: `npc,${transformTarget},spoken`,
        });
        
        // Don't fall through to LLM - transform intent is handled
        return;
      }
      
      // Different form - execute transform
      bootLog.info(`Chat transform detected: ${active.form_id} → ${transformTarget}`);

      const result = transformMeepo(message.guildId, transformTarget);

      if (result.success) {
        // Update the active instance reference
        active = getActiveMeepo(message.guildId)!;

        // Update bot nickname to match persona
        const guild = client.guilds.cache.get(message.guildId);
        if (guild) {
          await setBotNicknameForPersona(guild, transformTarget);
        }

        // Send in-character acknowledgement with flavor text
        let ackMessage: string;
        if (transformTarget === "xoblob") {
          ackMessage = "Meepo curls up... and becomes an echo of Old Xoblob.\n\n... I SEE A BEE ATE A PEA...";
        } else {
          ackMessage = "Meepo shimmers... and returns to itself.\n\nMeepo is here, meep.";
        }

        const reply = await message.reply(ackMessage);

        // Log the transform action
        appendLedgerEntry({
          guild_id: message.guildId,
          channel_id: message.channelId,
          message_id: `system:transform:${Date.now()}`,
          author_id: "system",
          author_name: "SYSTEM",
          timestamp_ms: Date.now(),
          content: `Transform triggered: ${transformTarget}`,
          tags: "system,action,transform",
        });

        // Log bot's acknowledgement
        appendLedgerEntry({
          guild_id: message.guildId,
          channel_id: message.channelId,
          message_id: reply.id,
          author_id: client.user!.id,
          author_name: client.user!.username,
          timestamp_ms: reply.createdTimestamp,
          content: ackMessage,
          tags: `npc,${transformTarget},spoken,transform-ack`,
        });

        // Don't continue to LLM response - transform message is handled
        return;
      }
    }

    // 4) Response gating: Auto-respond in bound channel, require address elsewhere
    const prefix = process.env.BOT_PREFIX ?? "meepo:";

    const mentionedMeepo = message.mentions?.users?.has(client.user!.id) ?? false;
    const addressed = mentionedMeepo || isAddressed(content, prefix);
    const inBoundChannel = active.channel_id === message.channelId;

    const addressContext = mentionedMeepo ? "mention" : "prefix";
    const decision = addressed || inBoundChannel ? "✓ reply" : "✗ ignore";
    bootLog.debug(
      `🎯 TEXT GATE: addressed=${addressed} inBound=${inBoundChannel} (${addressContext}) → ${decision}`
    );

    // Respond if: addressed anywhere, OR in Meepo's bound channel
    if (!addressed && !inBoundChannel) return;

    // 5) Generate response via LLM
    const llmEnabled = process.env.LLM_ENABLED !== "false";
    
    if (!llmEnabled) {
      const reply = await message.reply("meep");
      // Log bot's own reply
      appendLedgerEntry({
        guild_id: message.guildId,
        channel_id: message.channelId,
        message_id: reply.id,
        author_id: client.user!.id,
        author_name: client.user!.username,
        timestamp_ms: reply.createdTimestamp,
        content: "meep",
        tags: "npc,meepo,spoken",
      });
      return;
    }

    try {
      // Task 4.7: Use voice-aware context (prefers voice, falls back to text)
      const { context: recentContext, hasVoice } = getVoiceAwareContext({
        guildId: message.guildId,
        channelId: message.channelId,
      });

      // Task 9: Run recall pipeline for party memory injection
      let partyMemory = "";
      const memoryEnabled = process.env.MEEPO_MEMORY_ENABLED !== "false";
      
      if (memoryEnabled) {
        try {
          const registry = loadRegistry();
          const matches = extractRegistryMatches(content, registry);
          
          recallLog.debug(`Registry matches: ${matches.length} [${matches.map(m => m.canonical).join(", ")}]`);

          if (matches.length > 0) {
            // Search for events using registry matches
            const allEvents = new Map<string, EventRow>();
            for (const match of matches) {
              const events = searchEventsByTitle(match.canonical);
              recallLog.debug(`Events for "${match.canonical}": ${events.length}`);
              for (const event of events) {
                allEvents.set(event.event_id, event);
              }
            }
            
            recallLog.debug(`Total unique events: ${allEvents.size}`);

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
              const db = getDb();

              for (const [sessionId, sessionEvents] of eventsBySession.entries()) {
                // Get session label for GPTcap loading
                const labelRow = db.prepare("SELECT label FROM sessions WHERE session_id = ? LIMIT 1")
                  .get(sessionId) as { label: string | null } | undefined;
                const label = labelRow?.label;
                
                recallLog.debug(`Session ${sessionId.slice(0, 8)}... has label: ${label ?? "(none)"}`);

                if (label) {
                  const gptcap = loadGptcap(label);
                  recallLog.debug(`GPTcap for "${label}": ${gptcap ? `${gptcap.beats.length} beats` : "not found"}`);
                  if (gptcap) {
                    const relevantBeats = findRelevantBeats(gptcap, sessionEvents, { topK: 6 });
                    recallLog.debug(`Found ${relevantBeats.length} relevant beats for ${label}`);
                    allBeats.push(...relevantBeats);
                  }
                }
              }
              
              recallLog.debug(`Total beats across all sessions: ${allBeats.length}`);

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
                    const transcriptLines = getTranscriptLines(firstSessionWithLines, neededLines);
                    partyMemory = buildMemoryContext(allBeats, transcriptLines, {
                      maxLinesPerBeat: 2,
                      maxTotalChars: 1600,
                    });
                    recallLog.debug(`Built memory context: ${partyMemory.length} chars`);
                  }
                }
              }
            }
          }
        } catch (recallErr: any) {
          recallLog.warn(`Memory retrieval failed: ${recallErr.message ?? recallErr}`);
          // Continue without memory context on error
        }
      }
      
      if (partyMemory) {
        recallLog.debug(`Injecting party memory into prompt`);
      }

      // Layer 0: Build conversation tail context (session-scoped)
      const activeSession = getActiveSession(message.guildId);
      const { tailBlock } = buildConvoTailContext(activeSession?.session_id ?? null);

      const personaId = getActivePersonaId(message.guildId);
      const mindspace = getMindspace(message.guildId, personaId);

      // Campaign persona with no active session: soft refusal (no LLM)
      if (mindspace === null) {
        const reply = await message.reply(
          "I don't feel anchored yet—start a session first."
        );
        appendLedgerEntry({
          guild_id: message.guildId,
          channel_id: message.channelId,
          message_id: reply.id,
          author_id: client.user!.id,
          author_name: client.user!.username,
          timestamp_ms: reply.createdTimestamp,
          content: reply.content,
          tags: "npc,meepo,spoken",
        });
        return;
      }

      const promptResult = await buildMeepoPrompt({
        personaId,
        mindspace,
        meepo: active,
        recentContext,
        hasVoiceContext: hasVoice,
        partyMemory,
        convoTail: tailBlock || undefined,
      });

      textReplyLog.info(
        `persona_id=${promptResult.personaId} mindspace=${promptResult.mindspace ?? "n/a"} memory_refs=${promptResult.memoryRefs.length}`
      );

      const sanitizedAuthorName = getSanitizedSpeakerName(
        message.guildId,
        message.author.id,
        message.member?.displayName ?? message.author.username ?? "someone"
      );

      const userMessage = buildUserMessage({
        authorName: sanitizedAuthorName,
        content,
      });

      // Layer 0: Log player message before LLM call
      if (activeSession) {
        logConvoTurn({
          session_id: activeSession.session_id,
          channel_id: message.channelId,
          message_id: message.id,
          speaker_id: message.author.id,
          speaker_name: sanitizedAuthorName,
          role: "player",
          content_raw: content,
        });
      }

      const response = await chat({
        systemPrompt: promptResult.systemPrompt,
        userMessage,
      });

      // Layer 0: Log Meepo's response after LLM call
      if (activeSession) {
        logConvoTurn({
          session_id: activeSession.session_id,
          channel_id: message.channelId,
          message_id: null, // Will be set once reply is sent
          speaker_id: client.user?.id ?? null,
          speaker_name: "Meepo",
          role: "meepo",
          content_raw: response,
        });
      }

      textReplyLog.info(`💬 Meepo: "${response}"`);

      const reply = await message.reply(response);

      // Observability: log usage with persona + mindspace
      const db = getDb();
      db.prepare(`
        INSERT INTO meep_usages (id, session_id, message_id, guild_id, channel_id, triggered_at_ms, response_tokens, used_memories, persona_id, mindspace, created_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        activeSession?.session_id ?? null,
        message.id,
        message.guildId,
        message.channelId,
        message.createdTimestamp,
        null,
        JSON.stringify(promptResult.memoryRefs),
        promptResult.personaId,
        promptResult.mindspace ?? null,
        Date.now()
      );

      // Log bot's own reply
      appendLedgerEntry({
        guild_id: message.guildId,
        channel_id: message.channelId,
        message_id: reply.id,
        author_id: client.user!.id,
        author_name: client.user!.username,
        timestamp_ms: reply.createdTimestamp,
        content: response,
        tags: "npc,meepo,spoken",
      });
    } catch (llmErr: any) {
      console.error("LLM error:", llmErr);
      
      // Fallback to meep on LLM failure
      const fallbackReply = "meep (LLM unavailable)";
      textReplyLog.info(`💬 Meepo: "${fallbackReply}"`);
      const reply = await message.reply(fallbackReply);
      appendLedgerEntry({
        guild_id: message.guildId,
        channel_id: message.channelId,
        message_id: reply.id,
        author_id: client.user!.id,
        author_name: client.user!.username,
        timestamp_ms: reply.createdTimestamp,
        content: fallbackReply,
        tags: "npc,meepo,spoken",
      });
    }

  } catch (err) {
    console.error("messageCreate error", err);
  }
});

client.login(process.env.DISCORD_TOKEN);
