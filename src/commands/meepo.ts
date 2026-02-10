import { SlashCommandBuilder } from "discord.js";
import { getActiveMeepo, wakeMeepo, sleepMeepo } from "../meepo/state.js";
import { clearLatch } from "../latch/latch.js";

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
      if (active) clearLatch(guildId, active.channel_id);

      const changes = sleepMeepo(guildId);
      await interaction.reply({
        content: changes > 0 ? "Meepo goes dormant." : "Meepo is already asleep.",
        ephemeral: true,
      });
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

      await interaction.reply({
        content:
          "Meepo status:\n" +
          "- awake: yes\n" +
          "- bound channel: <#" + inst.channel_id + ">\n" +
          "- persona: " + (inst.persona_seed ?? "(none)") + "\n" +
          "- created_at_ms: " + inst.created_at_ms,
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({ content: "Unknown subcommand.", ephemeral: true });
  },
};
