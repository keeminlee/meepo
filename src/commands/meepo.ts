import { SlashCommandBuilder } from "discord.js";
import { getActiveMeepo, wakeMeepo, sleepMeepo, transformMeepo } from "../meepo/state.js";
import { clearLatch, setLatch } from "../latch/latch.js";
import { getAvailableForms, getPersona } from "../personas/index.js";
import { setBotNicknameForPersona } from "../meepo/nickname.js";
import { appendLedgerEntry } from "../ledger/ledger.js";
import { logSystemEvent } from "../ledger/system.js";
import { joinVoice, leaveVoice } from "../voice/connection.js";
import { getVoiceState, setVoiceState, clearVoiceState } from "../voice/state.js";
import { startReceiver, stopReceiver } from "../voice/receiver.js";

export const meepo = {
  data: new SlashCommandBuilder()
    .setName("meepo")
    .setDescription("Manage Meepo (wake, sleep, status, hush).")
    .addSubcommand((sub) =>
      sub
        .setName("wake")
        .setDescription("Awaken Meepo and bind it to this channel.")
        .addStringOption((opt) =>
          opt
            .setName("persona")
            .setDescription("Optional persona seed (short).")
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("sleep")
        .setDescription("Put Meepo to sleep.")
    )
    .addSubcommand((sub) =>
      sub
        .setName("status")
        .setDescription("Show Meepo's current state.")
    )
    .addSubcommand((sub) =>
      sub
        .setName("hush")
        .setDescription("Clear Meepo's latch (stop responding until addressed again).")
    )
    .addSubcommand((sub) =>
      sub
        .setName("transform")
        .setDescription("Transform Meepo into a different form.")
        .addStringOption((opt) =>
          opt
            .setName("character")
            .setDescription("Character to mimic (meepo, xoblob)")
            .setRequired(true)
            .addChoices(
              { name: "Meepo (default)", value: "meepo" },
              { name: "Old Xoblob", value: "xoblob" }
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("join")
        .setDescription("Join your voice channel (requires /meepo wake first).")
    )
    .addSubcommand((sub) =>
      sub
        .setName("leave")
        .setDescription("Leave voice channel.")
    )
    .addSubcommand((sub) =>
      sub
        .setName("stt")
        .setDescription("Manage speech-to-text (STT) transcription.")
        .addStringOption((opt) =>
          opt
            .setName("action")
            .setDescription("Enable, disable, or check STT status")
            .setRequired(true)
            .addChoices(
              { name: "on", value: "on" },
              { name: "off", value: "off" },
              { name: "status", value: "status" }
            )
        )
    ),

  async execute(interaction: any) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId as string | null;

    if (!guildId) {
      await interaction.reply({ content: "Meepo only works in a server (not DMs).", ephemeral: true });
      return;
    }

    if (sub === "wake") {
      const persona = interaction.options.getString("persona");
      const channelId = interaction.channelId as string;

      const inst = wakeMeepo({
        guildId,
        channelId,
        personaSeed: persona,
      });

      // Log system event (narrative primary)
      logSystemEvent({
        guildId,
        channelId,
        eventType: "npc_wake",
        content: `Meepo awakens${persona ? ` with persona: ${persona}` : ""}.`,
        authorId: interaction.user.id,
        authorName: interaction.user.username,
      });

      // Reset nickname to default Meepo on wake
      if (interaction.guild) {
        await setBotNicknameForPersona(interaction.guild, "meepo");
      }

      // Auto-latch so Meepo is ready to respond to next message
      const latchSeconds = Number(process.env.LATCH_SECONDS ?? "90");
      setLatch(guildId, channelId, latchSeconds);

      await interaction.reply({
        content:
          "Meepo awakens.\n" +
          "Bound channel: <#" + inst.channel_id + ">\n" +
          (inst.persona_seed ? ("Persona: " + inst.persona_seed) : "Persona: (none)"),
        ephemeral: true,
      });
      return;
    }

    if (sub === "sleep") {
      const active = getActiveMeepo(guildId);
      if (active) {
        clearLatch(guildId, active.channel_id);
        
        // Log system event (narrative primary)
        logSystemEvent({
          guildId,
          channelId: active.channel_id,
          eventType: "npc_sleep",
          content: "Meepo goes dormant.",
          authorId: interaction.user.id,
          authorName: interaction.user.username,
        });
      }

      const changes = sleepMeepo(guildId);

      await interaction.reply({
        content: changes > 0 ? "Meepo goes dormant." : "Meepo is already asleep.",
        ephemeral: true,
      });

      // Reset nickname to default Meepo after replying (to avoid interaction timeout)
      if (interaction.guild) {
        setBotNicknameForPersona(interaction.guild, "meepo").catch(err => 
          console.warn("Failed to reset nickname on sleep:", err.message)
        );
      }

      return;
    }

    if (sub === "hush") {
      const active = getActiveMeepo(guildId);
      if (!active) {
        await interaction.reply({ content: "Meepo is asleep.", ephemeral: true });
        return;
      }
      clearLatch(guildId, active.channel_id);
      await interaction.reply({ content: "Meepo hushes. (Latch cleared)", ephemeral: true });
      return;
    }

    if (sub === "status") {
      const inst = getActiveMeepo(guildId);
      if (!inst) {
        await interaction.reply({ content: "Meepo is asleep. Use /meepo wake in the channel you want.", ephemeral: true });
        return;
      }

      const persona = getPersona(inst.form_id);
      await interaction.reply({
        content:
          "Meepo status:\n" +
          "- awake: yes\n" +
          "- bound channel: <#" + inst.channel_id + ">\n" +
          "- current form: " + persona.displayName + " (" + inst.form_id + ")\n" +
          "- persona: " + (inst.persona_seed ?? "(none)") + "\n" +
          "- created_at_ms: " + inst.created_at_ms,
        ephemeral: true,
      });
      return;
    }

    if (sub === "transform") {
      const character = interaction.options.getString("character", true);
      
      const active = getActiveMeepo(guildId);
      if (!active) {
        await interaction.reply({ content: "Meepo is asleep. Use /meepo wake first.", ephemeral: true });
        return;
      }

      try {
        const persona = getPersona(character); // Validate form exists
        const result = transformMeepo(guildId, character);
        
        if (!result.success) {
          await interaction.reply({ content: result.error ?? "Transform failed.", ephemeral: true });
          return;
        }

        // Log system event (narrative primary)
        logSystemEvent({
          guildId,
          channelId: active.channel_id,
          eventType: "npc_transform",
          content: `Meepo transforms into ${persona.displayName}.`,
          authorId: interaction.user.id,
          authorName: interaction.user.username,
        });

        // Update bot nickname to match persona
        if (interaction.guild) {
          await setBotNicknameForPersona(interaction.guild, character);
        }

        // Auto-latch so Meepo is ready to respond to next message
        const latchSeconds = Number(process.env.LATCH_SECONDS ?? "90");
        setLatch(guildId, active.channel_id, latchSeconds);

        if (character === "meepo") {
          await interaction.reply({
            content: "Meepo shimmers... and returns to itself.",
            ephemeral: true,
          });
        } else if (character === "xoblob") {
          await interaction.reply({
            content: "Meepo curls up... and becomes an echo of Old Xoblob.",
            ephemeral: true,
          });
        } else {
          await interaction.reply({
            content: `Meepo transforms into ${persona.displayName}.`,
            ephemeral: true,
          });
        }
      } catch (err: any) {
        await interaction.reply({ content: "Unknown character form: " + character, ephemeral: true });
      }
      return;
    }

    if (sub === "join") {
      // Require Meepo to be awake before joining voice
      const active = getActiveMeepo(guildId);
      if (!active) {
        await interaction.reply({
          content: "Meepo is asleep. Use /meepo wake first.",
          ephemeral: true,
        });
        return;
      }

      // Check if user is in a voice channel
      // Fetch fresh member data to avoid cache issues
      const guild = interaction.guild;
      if (!guild) {
        await interaction.reply({
          content: "This command only works in a server.",
          ephemeral: true,
        });
        return;
      }

      const member = await guild.members.fetch(interaction.user.id);
      const userVoiceChannel = member.voice.channel;

      if (!userVoiceChannel) {
        await interaction.reply({
          content: "Meep? Meepo can't find you! Join a voice channel first, friend!",
          ephemeral: true,
        });
        return;
      }

      // Check if already connected
      const currentState = getVoiceState(guildId);
      if (currentState) {
        if (currentState.channelId === userVoiceChannel.id) {
          await interaction.reply({
            content: "Meep! Meepo is already here with you!",
            ephemeral: true,
          });
          return;
        } else {
          await interaction.reply({
            content: `Meepo is already listening in <#${currentState.channelId}>! Ask Meepo to leave first, meep?`,
            ephemeral: true,
          });
          return;
        }
      }

      // Join voice channel
      // Defer reply immediately to prevent timeout
      await interaction.deferReply({ ephemeral: true });

      try {
        const connection = await joinVoice({
          guildId,
          channelId: userVoiceChannel.id,
          adapterCreator: guild.voiceAdapterCreator,
        });

        // Store state
        setVoiceState(guildId, {
          channelId: userVoiceChannel.id,
          connection,
          sttEnabled: false, // Default to disabled
          connectedAt: Date.now(),
        });

        // Log system event (narrative primary)
        logSystemEvent({
          guildId,
          channelId: active.channel_id,
          eventType: "voice_join",
          content: `Meepo joins voice channel: ${userVoiceChannel.name}`,
          authorId: interaction.user.id,
          authorName: interaction.user.username,
        });

        // Resolve deferred interaction with success message
        await interaction.editReply({
          content: `*poof!* Meepo is here! Listening in <#${userVoiceChannel.id}>! Meep meep! 🎧`,
        }).catch((editErr: any) => {
          console.error("[Voice] Failed to edit reply after join:", editErr);
        });
      } catch (err: any) {
        console.error("[Voice] Failed to join:", err);
        
        // Ensure interaction is resolved even if join failed
        await interaction.editReply({
          content: `Meep meep... Meepo couldn't get there! (${err.message})`,
        }).catch((editErr: any) => {
          console.error("[Voice] Failed to edit reply after error:", editErr);
        });
      }
      return;
    }

    if (sub === "leave") {
      const currentState = getVoiceState(guildId);
      if (!currentState) {
        await interaction.reply({
          content: "Meep? Meepo isn't in voice right now!",
          ephemeral: true,
        });
        return;
      }

      const channelId = currentState.channelId;
      
      // Stop receiver if active
      stopReceiver(guildId);
      
      leaveVoice(guildId);

      // Log system event (narrative primary)
      const active = getActiveMeepo(guildId);
      if (active) {
        logSystemEvent({
          guildId,
          channelId: active.channel_id,
          eventType: "voice_leave",
          content: "Meepo leaves voice channel.",
          authorId: interaction.user.id,
          authorName: interaction.user.username,
        });
      }

      await interaction.reply({
        content: `*poof!* Meepo leaves <#${channelId}>. Bye bye! Meep!`,
        ephemeral: true,
      });
      return;
    }

    if (sub === "stt") {
      const action = interaction.options.getString("action", true);
      const currentState = getVoiceState(guildId);

      if (!currentState) {
        await interaction.reply({
          content: "Meep? Meepo needs to join voice first!",
          ephemeral: true,
        });
        return;
      }

      if (action === "status") {
        const active = getActiveMeepo(guildId);
        await interaction.reply({
          content:
            "**Meepo's Voice Status** 🎧\n" +
            `- Listening in: <#${currentState.channelId}>\n` +
            `- Understanding words: ${currentState.sttEnabled ? "yes! ✨" : "not yet"}\n` +
            `- Since: ${new Date(currentState.connectedAt).toLocaleString()}\n` +
            `\n_Meep! (Meepo forgets this if bot restarts)_`,
          ephemeral: true,
        });
        return;
      }

      if (action === "on") {
        if (currentState.sttEnabled) {
          await interaction.reply({
            content: "Meep! Meepo is already trying to understand words!",
            ephemeral: true,
          });
          return;
        }

        currentState.sttEnabled = true;

        // Start audio receiver
        startReceiver(guildId);

        // Log system event (narrative primary)
        const active = getActiveMeepo(guildId);
        if (active) {
          logSystemEvent({
            guildId,
            channelId: active.channel_id,
            eventType: "stt_toggle",
            content: "STT enabled (Phase 2 feature - no transcription yet).",
            authorId: interaction.user.id,
            authorName: interaction.user.username,
          });
        }

        await interaction.reply({
          content: "Meepo will try to understand words now! ✨\n_Meep meep... (Meepo is still learning this part!)_",
          ephemeral: true,
        });
        return;
      }

      if (action === "off") {
        if (!currentState.sttEnabled) {
          await interaction.reply({
            content: "Meep! Meepo wasn't trying to understand words anyway!",
            ephemeral: true,
          });
          return;
        }

        currentState.sttEnabled = false;

        // Stop audio receiver
        stopReceiver(guildId);

        // Log system event (narrative primary)
        const active = getActiveMeepo(guildId);
        if (active) {
          logSystemEvent({
            guildId,
            channelId: active.channel_id,
            eventType: "stt_toggle",
            content: "STT disabled.",
            authorId: interaction.user.id,
            authorName: interaction.user.username,
          });
        }

        await interaction.reply({
          content: "Okay! Meepo will just listen quietly now. Meep!",
          ephemeral: true,
        });
        return;
      }

      return;
    }

    await interaction.reply({ content: "Unknown subcommand.", ephemeral: true });
  },
};
