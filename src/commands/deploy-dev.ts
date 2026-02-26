import "dotenv/config";
import { REST, Routes } from "discord.js";
import { commandList } from "./index.js";
import { getEnv } from "../config/rawEnv.js";

const token = getEnv("DISCORD_TOKEN");
const clientId = getEnv("DISCORD_CLIENT_ID");
const guildId = getEnv("GUILD_ID");

if (!token || !clientId || !guildId) {
  console.error("Missing env vars. Need DISCORD_TOKEN, DISCORD_CLIENT_ID, GUILD_ID");
  process.exit(1);
}

// TypeScript doesn't narrow types after the guard, so assert they're defined
const rest = new REST({ version: "10" }).setToken(token);

async function main() {
  const body = commandList.map((c) => c.data.toJSON());
  console.log("Registering " + body.length + " commands to guild " + guildId + "...");
  await rest.put(Routes.applicationGuildCommands(clientId!, guildId!), { body });
  console.log("Guild commands registered.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
