import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { log } from "./utils/logger.js";
import { registerHandlers } from "./commands/index.js";
import { getActiveMeepo, wakeMeepo, transformMeepo } from "./meepo/state.js";
import { getEffectivePersonaId, getMindspace, setActivePersonaId } from "./meepo/personaState.js";
import { getGuildDefaultPersonaId, getGuildDmUserId, resolveCampaignSlug } from "./campaign/guildConfig.js";
import { getPersona } from "./personas/index.js";
import { startAutoSleepChecker } from "./meepo/autoSleep.js";
import { getActiveSession } from "./sessions/sessions.js";
import { getGuildMode } from "./sessions/sessionRuntime.js";
import { recoverInterruptedSessions } from "./sessions/sessionRecovery.js";
import { reconcileSessionStateOnBootForGuilds } from "./sessions/reconcileSessionsOnBoot.js";
import { appendLedgerEntry } from "./ledger/ledger.js";
import { startMeepoContextActionWorker } from "./ledger/meepoContextWorker.js";
import { getSanitizedSpeakerName } from "./ledger/speakerSanitizer.js";
import { logConvoTurn } from "./ledger/meepoConvo.js";
import { buildConvoTailContext } from "./recall/buildConvoTailContext.js";
import { loadMeepoContextSnapshot } from "./recall/loadMeepoContextSnapshot.js";
import { isWakePhrase, isLatchAnchor, containsPersonaName } from "./meepo/wakePhrase.js";
import {
  setLatch,
  isLatchActive,
  incrementLatchTurn,
  DEFAULT_LATCH_SECONDS,
  DEFAULT_MAX_LATCH_TURNS,
} from "./latch/latch.js";
import { getVoiceState } from "./voice/state.js";
import { getTtsProvider } from "./voice/tts/provider.js";
import { speakInGuild } from "./voice/speaker.js";
import { voicePlaybackController } from "./voice/voicePlaybackController.js";
import { applyPostTtsFx } from "./voice/audioFx.js";
import { recordMeepoInteraction, classifyTrigger } from "./ledger/meepoInteractions.js";
import { chat } from "./llm/client.js";
import { buildUserMessage } from "./llm/prompts.js";
import { buildMeepoPromptBundle } from "./llm/buildMeepoPromptBundle.js";
import { setBotNicknameForPersona } from "./meepo/nickname.js";
import { acquireLock } from "./pidlock.js";
import { getDbForCampaign, seedMeepoMemories } from "./db.js";
import { loadRegistryForScope } from "./registry/loadRegistry.js";
import { extractRegistryMatches } from "./registry/extractRegistryMatches.js";
import { searchEventsByTitleScoped, type EventRow } from "./ledger/eventSearch.js";
import { loadGptcap } from "./ledger/gptcapProvider.js";
import { findRelevantBeats, type ScoredBeat } from "./recall/findRelevantBeats.js";
import { buildMemoryContext } from "./recall/buildMemoryContext.js";
import { RECALL_SAFETY, boundedItems, checkAndRecordRecallThrottle } from "./recall/recallSafety.js";
import { getTranscriptLines } from "./ledger/transcripts.js";
import { randomUUID } from "node:crypto";
import { startOverlayServer, overlayEmitPresence } from "./overlay/server.js";
import { cfg, printConfigSnapshot } from "./config/env.js";
import {
  getOrCreateTraceId,
  runWithObservabilityContext,
} from "./observability/context.js";
import { formatUserFacingError } from "./errors/formatUserFacingError.js";
import { MeepoError } from "./errors/meepoError.js";
import { isDevUser } from "./security/devAccess.js";
import { shouldAllowConversationalTextOutput } from "./runtime/textReplyPolicy.js";

const bootLog = log.withScope("boot");
const overlayLog = log.withScope("overlay");
const textReplyLog = log.withScope("text-reply");
const recallLog = log.withScope("recall");

const TEXT_STOP_PHRASES = new Set<string>([
  "meepo stop",
  "meepo shush",
  "stop meepo",
]);

function normalizeStopPhrase(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function isTextStopPhrase(text: string): boolean {
  return TEXT_STOP_PHRASES.has(normalizeStopPhrase(text));
}

function detectLegacyConversationalTrigger(args: {
  message: any;
  content: string;
  guildMode: string;
  active: ReturnType<typeof getActiveMeepo>;
  defaultPersonaId: string;
}): string | null {
  const { message, content, guildMode, active, defaultPersonaId } = args;
  const mentionedMeepo = message.mentions?.users?.has(client.user!.id) ?? false;
  const autoWakeHit =
    isWakePhrase(content, defaultPersonaId, { mentioned: false, prefix: cfg.discord.botPrefix }) ||
    containsPersonaName(content, defaultPersonaId);

  if (!active && autoWakeHit) {
    return "auto_wake_trigger";
  }

  if (!active) {
    return null;
  }

  const contentLower = content.toLowerCase();
  const transformRequested =
    (
      contentLower.includes("xoblob")
      && (
        contentLower.includes("transform")
        || contentLower.includes("become")
        || contentLower.includes("turn into")
        || contentLower.includes("switch")
        || contentLower.includes("come out")
        || contentLower.startsWith("xoblob")
      )
    )
    || (
      (
        contentLower.includes("meepo")
        && (
          contentLower.includes("turn back")
          || contentLower.includes("back")
          || contentLower.includes("again")
          || contentLower.includes("transform")
          || contentLower.includes("become")
          || contentLower.includes("switch")
        )
      )
      || contentLower.includes("back to meepo")
      || contentLower.includes("regular meepo")
      || contentLower.includes("normal meepo")
    );

  if (transformRequested) {
    return "transform_trigger";
  }

  const personaId = getEffectivePersonaId(message.guildId);
  const isAnchor = isWakePhrase(content, personaId, { mentioned: mentionedMeepo, prefix: cfg.discord.botPrefix });
  const hasMeepo = containsPersonaName(content, personaId) || mentionedMeepo;
  const inBoundChannel = active.channel_id === message.channelId;
  const latched = isLatchActive(message.guildId, message.channelId, message.author.id);
  const dmUserId = getGuildDmUserId(message.guildId);

  if (guildMode === "canon" && dmUserId && message.author.id === dmUserId) {
    return null;
  }

  let replyMode: "voice" | "text" | "none" = "none";
  if (isAnchor) {
    replyMode = "voice";
  } else if (hasMeepo) {
    replyMode = latched ? "voice" : "text";
  } else if (latched) {
    replyMode = "text";
  }

  if (replyMode === "none") {
    return null;
  }

  if (!inBoundChannel && !isAnchor) {
    return null;
  }

  return "reply_mode_trigger";
}

printConfigSnapshot(cfg);

// PID lock: prevent multiple instances
if (!acquireLock()) {
  process.exit(1);
}

bootLog.info("Process startup diagnostics", {
  event_type: "PROCESS_STARTUP_DIAGNOSTICS",
  pid: process.pid,
  ppid: process.ppid,
  node_version: process.version,
  meepo_mode: cfg.mode,
  build_marker: process.env.MEEPO_BUILD_ID ?? process.env.npm_package_version ?? "dev-local",
  started_at_ms: Date.now(),
});

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
  const announcementChannelId = cfg.session.announcementChannelId;
  if (announcementChannelId) {
    bootLog.info(`Announcement channel configured: ${announcementChannelId}`);
  } else {
    bootLog.warn(`ANNOUNCEMENT_CHANNEL_ID not set. /meepo announce will reply with error.`);
  }

  // Restore Meepo active state for connected guilds (no single-guild env dependency)
  if (client.guilds.cache.size === 0) {
    bootLog.info("Startup restore skipped: bot is not in any guilds.");
  } else {
    const guildIds = Array.from(client.guilds.cache.keys());

    // Recovery mutates DB truth; reconciliation then derives runtime state from that truth.
    const bootRecoverySummary = recoverInterruptedSessions(guildIds);
    bootLog.info(
      `Session boot recovery: total=${bootRecoverySummary.totalGuilds} scanned_active=${bootRecoverySummary.scannedActiveSessions} interrupted=${bootRecoverySummary.interruptedSessions}`
    );

    const bootReconcileSummary = reconcileSessionStateOnBootForGuilds(guildIds);
    bootLog.info(
      `Session boot reconciliation: total=${bootReconcileSummary.totalGuilds} changed=${bootReconcileSummary.changedGuilds} set=${bootReconcileSummary.setRuntimeActiveCount} cleared=${bootReconcileSummary.clearedRuntimeActiveCount}`
    );

    for (const guild of client.guilds.cache.values()) {
      const activeMeepo = getActiveMeepo(guild.id);
      if (!activeMeepo) continue;

      bootLog.info(
        `Meepo restored guild=${guild.id}: form=${activeMeepo.form_id}, channel=${activeMeepo.channel_id}, session continues`
      );
    }
  }

  // Start auto-sleep checker for inactive Meepo instances
  startAutoSleepChecker();

  // Start context action worker (separate from heartbeat enqueue path)
  startMeepoContextActionWorker();

});

// Track voice channel presence for overlay (who's in voice)
client.on("voiceStateUpdate", (oldState, newState) => {
  const overlayChannelId = cfg.overlay.voiceChannelId;
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

    const activeVoiceState = getVoiceState(message.guildId);
    if (activeVoiceState && isTextStopPhrase(content)) {
      voicePlaybackController.abort(message.guildId, "explicit_text_stop", {
        channelId: activeVoiceState.channelId,
        authorId: message.author.id,
        authorName: message.member?.displayName ?? message.author.username ?? message.author.id,
        phrase: content,
        source: "text",
        logSystemEvent: true,
      });
      return;
    }

    const campaignSlug = resolveCampaignSlug({
      guildId: message.guildId ?? undefined,
      guildName: message.guild?.name ?? undefined,
    });
    const db = getDbForCampaign(campaignSlug);
    const traceId = getOrCreateTraceId();
    const interactionId = message.id as string;

    await runWithObservabilityContext(
      {
        trace_id: traceId,
        interaction_id: interactionId,
        guild_id: message.guildId,
        campaign_slug: campaignSlug,
      },
      async () => {

    // Get active session if one exists (for session_id tracking)
    const activeSession = getActiveSession(message.guildId);

    // 1) LEDGER: log every message in the guild that Meepo can see
    const inboundLedgerId = appendLedgerEntry({
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

    const guildMode = getGuildMode(message.guildId);
    if (guildMode === "dormant") {
      bootLog.debug(`🎯 TEXT GATE: guild mode dormant → ignore`);
      return;
    }

    const activeForPolicy = getActiveMeepo(message.guildId);
    const defaultPersonaId = getGuildDefaultPersonaId(message.guildId) ?? "meta_meepo";
    const textReplyPolicy = shouldAllowConversationalTextOutput({
      nodeEnv: process.env.NODE_ENV,
      isDevUser: isDevUser(message.author?.id),
    });

    if (!textReplyPolicy.allowed) {
      const suppressedTrigger = detectLegacyConversationalTrigger({
        message,
        content,
        guildMode,
        active: activeForPolicy,
        defaultPersonaId,
      });

      if (suppressedTrigger) {
        textReplyLog.info("Suppressed conversational text reply", {
          event_type: "TEXT_REPLY_SUPPRESSED",
          guild_id: message.guildId,
          channel_id: message.channelId,
          user_id: message.author.id,
          reason: textReplyPolicy.reason,
          trigger: suppressedTrigger,
          interaction_id: interactionId,
        });
      }

      return;
    }

    // 2) AWAKEN-ON-NAME: Auto-awaken Meepo if message contains "meepo" and Meepo is not active
    let active = activeForPolicy;
    const contentLower = content.toLowerCase();

    const defaultPersonaName = getPersona(defaultPersonaId).displayName.toLowerCase();
    const autoWakeHit =
      isWakePhrase(content, defaultPersonaId, { mentioned: false, prefix: cfg.discord.botPrefix }) ||
      containsPersonaName(content, defaultPersonaId);

    if (!active && autoWakeHit) {
      bootLog.info(`AUTO-AWAKEN triggered by ${message.author.username} in channel ${message.channelId}`);
      
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
      
      // Log the auto-awaken action
      appendLedgerEntry({
        guild_id: message.guildId,
        channel_id: message.channelId,
        message_id: `system:wake:${Date.now()}`,
        author_id: "system",
        author_name: "SYSTEM",
        timestamp_ms: Date.now(),
        content: `Auto-awaken triggered by text containing wakephrase/name (meepo or ${defaultPersonaName}).`,
        tags: "system,action,wake",
      });

      // Persona Overhaul v1: default to Meta Meepo on wake
      setActivePersonaId(message.guildId, defaultPersonaId);

      // Continue processing to respond to the wake message
    }

    // If still no active Meepo, nothing more to do
    if (!active) return;

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

    // 4) Tier S/A: Per-user latch. Tier S = voice reply, Tier A = text reply.
    const prefix = cfg.discord.botPrefix;
    const personaId = getEffectivePersonaId(message.guildId);
    const userId = message.author.id;
    const mentionedMeepo = message.mentions?.users?.has(client.user!.id) ?? false;
    const isAnchor = isWakePhrase(content, personaId, { mentioned: mentionedMeepo, prefix });
    const hasMeepo = containsPersonaName(content, personaId) || mentionedMeepo;
    const inBoundChannel = active.channel_id === message.channelId;
    const dmUserId = getGuildDmUserId(message.guildId);

    if (guildMode === "canon" && dmUserId && userId === dmUserId) {
      bootLog.debug(`🎯 TEXT GATE: canon DM firewall → no trigger`);
      return;
    }

    if (isLatchAnchor(content, personaId)) {
      setLatch(message.guildId, message.channelId, userId, DEFAULT_LATCH_SECONDS, DEFAULT_MAX_LATCH_TURNS);
    }
    const latched = isLatchActive(message.guildId, message.channelId, userId);

    // Reply decision: anchor → voice (or text); hasMeepo+latched → voice; hasMeepo → text; latched → text; else none
    let replyMode: "voice" | "text" | "none" = "none";
    if (isAnchor) {
      replyMode = "voice"; // prefer voice; fall back to text if no voice state
    } else if (hasMeepo) {
      replyMode = latched ? "voice" : "text";
    } else if (latched) {
      replyMode = "text";
    }

    if (replyMode === "none") {
      if (inBoundChannel && !latched && !hasMeepo) {
        bootLog.debug(`🎯 TEXT GATE: no name, not latched → ignore`);
      } else if (!inBoundChannel && !isAnchor) {
        bootLog.debug(`🎯 TEXT GATE: not in bound channel, not anchor → ignore`);
      }
      return;
    }
    if (!inBoundChannel && !isAnchor) return;

    const voiceState = getVoiceState(message.guildId);
    const useVoice = replyMode === "voice" && !!voiceState;
    bootLog.debug(
      `🎯 TEXT GATE: isAnchor=${isAnchor} hasMeepo=${hasMeepo} latched=${latched} replyMode=${replyMode} useVoice=${useVoice}`
    );

    // 5) Generate response via LLM
    const llmEnabled = cfg.llm.enabled;
    
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
      const { context: recentContext, hasVoice } = await loadMeepoContextSnapshot({
        guildId: message.guildId,
        sessionId: activeSession?.session_id ?? null,
        anchorLedgerId: inboundLedgerId ?? message.id,
      });

      // Task 9: Run recall pipeline for party memory injection
      let partyMemory = "";
      const memoryEnabled = cfg.features.memoryEnabled;
      
      if (memoryEnabled) {
        try {
          const throttle = checkAndRecordRecallThrottle({
            guildId: message.guildId,
            actorUserId: message.author.id,
            surface: "text_message",
          });
          if (throttle.throttled) {
            recallLog.debug(
              `Recall throttled (surface=text_message reason=${throttle.reason} retry_ms=${throttle.retryAfterMs})`
            );
          } else {
          const registry = loadRegistryForScope({ guildId: message.guildId, campaignSlug });
          const matches = boundedItems(
            extractRegistryMatches(content, registry),
            RECALL_SAFETY.shape.maxRegistryMatches
          );
          
          recallLog.debug(`Registry matches: ${matches.length} [${matches.map(m => m.canonical).join(", ")}]`);

          if (matches.length > 0) {
            // Search for events using registry matches
            const allEvents = new Map<string, EventRow>();
            for (const match of matches) {
              const events = searchEventsByTitleScoped({
                term: match.canonical,
                scope: { guildId: message.guildId, campaignSlug },
                limit: RECALL_SAFETY.shape.maxEventsPerMatch,
              });
              recallLog.debug(`Events for "${match.canonical}": ${events.length}`);
              for (const event of events) {
                if (allEvents.size >= RECALL_SAFETY.shape.maxUniqueEvents) {
                  break;
                }
                allEvents.set(event.event_id, event);
              }
              if (allEvents.size >= RECALL_SAFETY.shape.maxUniqueEvents) {
                break;
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

              for (const [sessionId, sessionEvents] of boundedItems(
                Array.from(eventsBySession.entries()),
                RECALL_SAFETY.shape.maxSessionsWithEvents
              )) {
                // Get session label for GPTcap loading
                const labelRow = db.prepare("SELECT label FROM sessions WHERE session_id = ? LIMIT 1")
                  .get(sessionId) as { label: string | null } | undefined;
                const label = labelRow?.label;
                
                recallLog.debug(`Session ${sessionId.slice(0, 8)}... has label: ${label ?? "(none)"}`);

                if (label) {
                  const gptcap = loadGptcap(label);
                  recallLog.debug(`GPTcap for "${label}": ${gptcap ? `${gptcap.beats.length} beats` : "not found"}`);
                  if (gptcap) {
                    const relevantBeats = findRelevantBeats(gptcap, sessionEvents, {
                      topK: RECALL_SAFETY.shape.maxBeatsPerSession,
                    });
                    recallLog.debug(`Found ${relevantBeats.length} relevant beats for ${label}`);
                    allBeats.push(...relevantBeats);
                    if (allBeats.length >= RECALL_SAFETY.shape.maxTotalBeats) {
                      break;
                    }
                  }
                }
              }

              const boundedBeats = boundedItems(allBeats, RECALL_SAFETY.shape.maxTotalBeats);
              
              recallLog.debug(`Total beats across all sessions: ${boundedBeats.length}`);

              // Build memory context if we have beats
              if (boundedBeats.length > 0) {
                // Collect all needed transcript lines from beats
                const linesBySession = new Map<string, Set<number>>();
                for (const scored of boundedBeats) {
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
                  const neededLines = boundedItems(
                    Array.from(linesBySession.get(firstSessionWithLines) || []),
                    RECALL_SAFETY.shape.maxTranscriptLines
                  );
                  if (neededLines.length > 0) {
                    const transcriptLines = getTranscriptLines(firstSessionWithLines, neededLines, { db });
                    partyMemory = buildMemoryContext(boundedBeats, transcriptLines, {
                      maxLinesPerBeat: 2,
                      maxTotalChars: 1600,
                    });
                    recallLog.debug(`Built memory context: ${partyMemory.length} chars`);
                  }
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
      const activeSessionForPrompt = getActiveSession(message.guildId);
      const { tailBlock } = buildConvoTailContext(activeSessionForPrompt?.session_id ?? null, message.guildId);

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

      const persona = getPersona(personaId);
      const promptBundle = buildMeepoPromptBundle({
        guild_id: message.guildId,
        campaign_slug: campaignSlug,
        session_id: activeSessionForPrompt?.session_id ?? "__ambient__",
        anchor_ledger_id: inboundLedgerId ?? message.id,
        trace_id: traceId,
        interaction_id: interactionId,
        user_text: content,
        meepo_context_snapshot: {
          context: recentContext || undefined,
          hasVoice,
          partyMemory,
          convoTail: tailBlock || undefined,
        },
        persona,
        meepo_persona_seed: active.persona_seed,
      });

      const memoryRefCount =
        (promptBundle.retrieval?.core_memories.length ?? 0)
        + (promptBundle.retrieval?.relevant_memories.length ?? 0);

      textReplyLog.info(
        `persona_id=${personaId} mindspace=${mindspace ?? "n/a"} memory_refs=${memoryRefCount}`
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
      if (activeSessionForPrompt) {
        logConvoTurn({
          guild_id: message.guildId,
          session_id: activeSessionForPrompt.session_id,
          channel_id: message.channelId,
          message_id: message.id,
          speaker_id: message.author.id,
          speaker_name: sanitizedAuthorName,
          role: "player",
          content_raw: content,
        });
      }

      const response = await chat({
        systemPrompt: promptBundle.system,
        userMessage,
        trace_id: traceId,
        interaction_id: interactionId,
        guild_id: message.guildId,
        campaign_slug: campaignSlug,
        session_id: activeSessionForPrompt?.session_id ?? undefined,
      });

      // Layer 0: Log Meepo's response after LLM call
      if (activeSessionForPrompt) {
        logConvoTurn({
          guild_id: message.guildId,
          session_id: activeSessionForPrompt.session_id,
          channel_id: message.channelId,
          message_id: null, // Will be set once reply is sent
          speaker_id: client.user?.id ?? null,
          speaker_name: "Meepo",
          role: "meepo",
          content_raw: response,
        });
      }

      textReplyLog.info(`💬 Meepo: "${response}"`);

      let actualVoiceSent = false;
      if (useVoice) {
        const vs = getVoiceState(message.guildId);
        if (vs) {
          try {
            const tts = await getTtsProvider();
            let audio = await tts.synthesize(response);
            if (audio.length > 0) {
              audio = await applyPostTtsFx(audio, "mp3");
              speakInGuild(message.guildId, audio, { userDisplayName: "[Meepo]" });
              actualVoiceSent = true;
            }
          } catch (voiceErr: any) {
            textReplyLog.warn(`Voice reply failed: ${voiceErr.message}`);
          }
        }
      }

      const reply = await message.reply(response).catch((replyErr: unknown) => {
        throw new MeepoError("ERR_DISCORD_REPLY_FAILED", {
          message: "Failed to send generated text reply",
          cause: replyErr,
          trace_id: traceId,
          interaction_id: interactionId,
        });
      });

      // Tier = reply channel: S = voice actually sent, A = text
      const tier = actualVoiceSent ? "S" : "A";
      const replyModeRecord = actualVoiceSent ? "voice" : "text";
      incrementLatchTurn(message.guildId, message.channelId, userId);

      const baseTrigger = isAnchor
        ? (mentionedMeepo ? "mention" : "wake_phrase")
        : latched
          ? "latched_followup"
          : "name_mention";
      const trigger = classifyTrigger(content, baseTrigger);
      recordMeepoInteraction({
        guildId: message.guildId,
        sessionId: activeSessionForPrompt?.session_id ?? null,
        personaId,
        tier,
        trigger,
        speakerId: userId,
        meta: {
          trigger_message_id: message.id,
          trigger_channel_id: message.channelId,
          reply_message_id: reply.id,
          reply_channel_id: message.channelId,
          reply_mode: replyModeRecord,
          latch_state: latched ? "latched" : "unlatched",
          latch_key: `${message.guildId}:${message.channelId}:${userId}`,
        },
      });

      // Observability: log usage with persona + mindspace
      db.prepare(`
        INSERT INTO meep_usages (id, session_id, message_id, guild_id, channel_id, triggered_at_ms, response_tokens, used_memories, persona_id, mindspace, created_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        activeSessionForPrompt?.session_id ?? null,
        message.id,
        message.guildId,
        message.channelId,
        message.createdTimestamp,
        null,
        JSON.stringify([
          ...(promptBundle.retrieval?.core_memories.map((m) => m.memory_id) ?? []),
          ...(promptBundle.retrieval?.relevant_memories.map((m) => m.memory_id) ?? []),
        ]),
        personaId,
        mindspace ?? null,
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
      const payload = formatUserFacingError(llmErr, {
        fallbackMessage: "meep (LLM unavailable)",
      });

      // Shared formatter keeps text and voice fallback policy consistent.
      const fallbackReply = payload.content;
      textReplyLog.info(`💬 Meepo: "${fallbackReply}"`);
      const reply = await message.reply(fallbackReply).catch((replyErr: unknown) => {
        throw new MeepoError("ERR_DISCORD_REPLY_FAILED", {
          message: "Failed to send fallback text reply",
          cause: replyErr,
          trace_id: traceId,
          interaction_id: interactionId,
        });
      });
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

      }
    );

  } catch (err) {
    const payload = formatUserFacingError(err, {
      fallbackMessage: "⚠️ Meepo hit an internal runtime failure.",
    });
    textReplyLog.error("messageCreate error", {
      event_type: "MESSAGE_CREATE_ERROR",
      interaction_id: message.id,
      error_code: payload.code,
      failure_class: payload.failureClass,
      trace_id: payload.trace_id,
      error: err instanceof Error ? err.message : String(err),
    }, {
      guild_id: message.guildId,
      campaign_slug: resolveCampaignSlug({
        guildId: message.guildId ?? undefined,
        guildName: message.guild?.name ?? undefined,
      }),
      session_id: getActiveSession(message.guildId)?.session_id ?? undefined,
      interaction_id: message.id,
      trace_id: payload.trace_id,
    });
  }
});

client.login(cfg.discord.token);
