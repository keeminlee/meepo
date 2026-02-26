import { SlashCommandBuilder } from "discord.js";
import type { CommandCtx } from "./index.js";

export const ping = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Sanity check: Meepo responds with pong."),
  async execute(interaction: any, _ctx: CommandCtx | null) {
    const sent = Date.now();
    await interaction.reply({ content: "pong", ephemeral: true });
    const latency = Date.now() - sent;
    await interaction.followUp({ content: "latency: " + latency + "ms", ephemeral: true });
  },
};
