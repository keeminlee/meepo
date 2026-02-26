import { Collection, type Client } from "discord.js";
import { ping } from "./ping.js";
import { meepo } from "./meepo.js";
import { session } from "./session.js";
import { meeps } from "./meeps.js";
import { missions } from "./missions.js";
import { goldmem } from "./goldmem.js";
import { cfg } from "../config/env.js";
import { resolveCampaignSlug } from "../campaign/guildConfig.js";
import { getDbForCampaign } from "../db.js";
import { resolveCampaignDbPath } from "../dataPaths.js";
import { getGuildMode } from "../sessions/sessionRuntime.js";
import { logRuntimeContextBanner } from "../runtime/runtimeContextBanner.js";

export type CommandCtx = {
  guildId: string;
  guildName?: string;
  campaignSlug: string;
  dbPath: string;
  db: any;
};

export const commandList = [ping, meepo, session, meeps, missions, goldmem];

export const commandMap = new Collection(
  commandList.map((c: any) => [c.data.name, c])
);

export function registerHandlers(client: Client) {
  client.on("interactionCreate", async (interaction: any) => {
    if (!interaction.isChatInputCommand()) return;

    const cmd = commandMap.get(interaction.commandName);
    if (!cmd) return;

    try {
      const guildId = (interaction.guildId as string | null) ?? null;
      const guildName = (interaction.guild?.name as string | undefined) ?? null;
      const mode = guildId ? getGuildMode(guildId) : cfg.mode;

      const commandCtx = guildId
        ? (() => {
            const campaignSlug = resolveCampaignSlug({ guildId, guildName });
            const dbPath = resolveCampaignDbPath(campaignSlug);
            const db = getDbForCampaign(campaignSlug);
            return {
              guildId,
              guildName: guildName ?? undefined,
              campaignSlug,
              dbPath,
              db,
            } satisfies CommandCtx;
          })()
        : null;

      logRuntimeContextBanner({
        entrypoint: `command:${interaction.commandName}`,
        guildId,
        guildName,
        mode,
        dbPath: commandCtx?.dbPath,
      });

      await cmd.execute(interaction, commandCtx);
    } catch (err) {
      console.error("Command error", interaction.commandName, err);
      const msg = "Something went wrong.";
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: msg, ephemeral: true }).catch(() => {});
      } else {
        await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
      }
    }
  });
}
