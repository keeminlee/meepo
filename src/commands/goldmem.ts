import { SlashCommandBuilder } from "discord.js";
import { getGoldMemoriesForQuery } from "../gold/goldMemoryRepo.js";
import { cfg } from "../config/env.js";
import type { CommandCtx } from "./index.js";

export const goldmem = {
  data: new SlashCommandBuilder()
    .setName("goldmem")
    .setDescription("Debug gold memory retrieval")
    .addStringOption((opt) =>
      opt.setName("character").setDescription("Character/name query").setRequired(true),
    ),

  async execute(interaction: any, ctx: CommandCtx | null) {
    const guildId = interaction.guildId as string | null;
    if (!guildId || !ctx) {
      await interaction.reply({ content: "Guild-only command.", ephemeral: true });
      return;
    }
    const enabled = cfg.features.goldMemoryEnabled;
    if (!enabled) {
      await interaction.reply({ content: "GOLD_MEMORY_ENABLED is off.", ephemeral: true });
      return;
    }

    const query = interaction.options.getString("character", true);
    const campaignSlug = ctx.campaignSlug;
    const rows = getGoldMemoriesForQuery({
      guildId,
      campaignSlug,
      query,
      limit: 5,
    });
    if (rows.length === 0) {
      await interaction.reply({
        content: `No gold memories found for "${query}" in ${campaignSlug}.`,
        ephemeral: true,
      });
      return;
    }

    const body = rows
      .map(
        (r, i) =>
          `${i + 1}) [${r.memory_key}] ${r.character}: ${r.summary} (score=${r.score.toFixed(2)}, g=${r.gravity.toFixed(2)}, c=${r.certainty.toFixed(2)}, r=${r.resilience.toFixed(2)})`,
      )
      .join("\n");
    await interaction.reply({
      content: `Gold memory top matches (${campaignSlug}):\n${body}`,
      ephemeral: true,
    });
  },
};
