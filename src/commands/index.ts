import { Collection, type Client } from "discord.js";
import { ping } from "./ping.js";
import { meepo } from "./meepo.js";
import { session } from "./session.js";
import { meeps } from "./meeps.js";
import { missions } from "./missions.js";

export const commandList = [ping, meepo, session, meeps, missions];

export const commandMap = new Collection(
  commandList.map((c: any) => [c.data.name, c])
);

export function registerHandlers(client: Client) {
  client.on("interactionCreate", async (interaction: any) => {
    if (!interaction.isChatInputCommand()) return;

    const cmd = commandMap.get(interaction.commandName);
    if (!cmd) return;

    try {
      await cmd.execute(interaction);
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
