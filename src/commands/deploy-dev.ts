import "dotenv/config";
import { REST, Routes } from "discord.js";
import { commandList } from "./index.js";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId || !guildId) {
  console.error("Missing env vars. Need DISCORD_TOKEN, DISCORD_CLIENT_ID, GUILD_ID");
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(token);

async function main() {
  const body = commandList.map((c) => c.data.toJSON());
  console.log("Registering " + body.length + " commands to guild " + guildId + "...");
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
  console.log("Guild commands registered.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
