import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { registerHandlers } from "./commands/index.js";
import { getActiveMeepo, wakeMeepo, transformMeepo } from "./meepo/state.js";
import { getActiveSession } from "./sessions/sessions.js";
import { appendLedgerEntry, getVoiceAwareContext } from "./ledger/ledger.js";
import { isLatchActive, setLatch } from "./latch/latch.js";
import { isAddressed } from "./meepo/triggers.js";
import { chat } from "./llm/client.js";
import { buildMeepoPrompt, buildUserMessage } from "./llm/prompts.js";
import { setBotNicknameForPersona } from "./meepo/nickname.js";
import { acquireLock } from "./pidlock.js";
import { seedMeepoMemories } from "./db.js";

// PID lock: prevent multiple instances
if (!acquireLock()) {
  process.exit(1);
}

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
  console.log("Meepo online as " + (client.user?.tag ?? "<unknown>"));
  
  // Initialize MeepoMind (seed foundational memories on first run)
  try {
    await seedMeepoMemories();
  } catch (err: any) {
    console.error("Failed to seed MeepoMind:", err.message ?? err);
  }
});

client.on("messageCreate", async (message: any) => {
  try {
    const authorDisplayName = message.member?.displayName ?? message.author.username ?? message.author.id;
    console.log(
      "MSG",
      message.channelId,
      authorDisplayName,
      JSON.stringify(message.content)
    );
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
      console.log("AUTO-WAKE triggered by:", message.author.username, "in channel:", message.channelId);
      
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
      
      // console.log("WAKE RESULT:", active);

      // Auto-latch so this message (and subsequent ones) can trigger responses
      const latchSeconds = Number(process.env.LATCH_SECONDS ?? "90");
      setLatch(message.guildId, message.channelId, latchSeconds);

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

      // Continue processing to respond to the wake message
    }

    // If still no active Meepo, nothing more to do
    if (!active) return;

    // console.log("ACTIVE MEEPO:", {
    //   id: active.id,
    //   form_id: active.form_id,
    //   persona_seed: active.persona_seed,
    // });

    // 3) SPEECH: only respond in Meepo's bound channel
    if (message.channelId !== active.channel_id) return;

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
        console.log("Already in form:", transformTarget, "- acknowledging without transform");
        
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
      console.log("Chat transform detected:", active.form_id, "→", transformTarget);

      const result = transformMeepo(message.guildId, transformTarget);

      if (result.success) {
        // Update the active instance reference
        active = getActiveMeepo(message.guildId)!;

        // Update bot nickname to match persona
        const guild = client.guilds.cache.get(message.guildId);
        if (guild) {
          await setBotNicknameForPersona(guild, transformTarget);
        }

        // Set latch
        const latchSeconds = Number(process.env.LATCH_SECONDS ?? "90");
        setLatch(message.guildId, message.channelId, latchSeconds);

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

    // 4) Address/latch logic (only relevant in bound channel)
    const prefix = process.env.BOT_PREFIX ?? "meepo:";
    const latchSeconds = Number(process.env.LATCH_SECONDS ?? "500");

    const mentionedMeepo = message.mentions?.users?.has(client.user!.id) ?? false;
    const addressed = mentionedMeepo || isAddressed(content, prefix);
    const latchActive = isLatchActive(message.guildId, message.channelId);

    // console.log("ADDR?", addressed, "LATCH?", latchActive);
    if (!addressed && !latchActive) return;

    // Extend latch once we respond
    setLatch(message.guildId, message.channelId, latchSeconds);

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

      const systemPrompt = await buildMeepoPrompt({
        meepo: active,
        recentContext,
        hasVoiceContext: hasVoice,
      });

      const userMessage = buildUserMessage({
        authorName: message.member?.displayName ?? message.author.username ?? "someone",
        content,
      });

      const response = await chat({
        systemPrompt,
        userMessage,
      });

      // console.log("MEEPO RESPONSE:", {
      //   form_id: active.form_id,
      //   response_preview: response.substring(0, 50),
      // });

      const reply = await message.reply(response);
      
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
      const reply = await message.reply("meep (LLM unavailable)");
      appendLedgerEntry({
        guild_id: message.guildId,
        channel_id: message.channelId,
        message_id: reply.id,
        author_id: client.user!.id,
        author_name: client.user!.username,
        timestamp_ms: reply.createdTimestamp,
        content: "meep (LLM unavailable)",
        tags: "npc,meepo,spoken",
      });
    }

  } catch (err) {
    console.error("messageCreate error", err);
  }
});

client.login(process.env.DISCORD_TOKEN);
