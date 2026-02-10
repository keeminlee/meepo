import { SlashCommandBuilder } from "discord.js";
import { getActiveMeepo, wakeMeepo, sleepMeepo, transformMeepo } from "../meepo/state.js";
import { clearLatch, setLatch } from "../latch/latch.js";
import { getAvailableForms, getPersona } from "../personas/index.js";
import { setBotNicknameForPersona } from "../meepo/nickname.js";
import { appendLedgerEntry } from "../ledger/ledger.js";
import { logSystemEvent } from "../ledger/system.js";

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

    await interaction.reply({ content: "Unknown subcommand.", ephemeral: true });
  },
};
