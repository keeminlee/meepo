import "dotenv/config";
import { REST, Routes } from "discord.js";
import { devGuildCommands, globalCommands } from "./index.js";
import { getEnv } from "../config/rawEnv.js";

function resolveApplicationId(): string {
  const appId = getEnv("DISCORD_APPLICATION_ID") ?? getEnv("DISCORD_CLIENT_ID");
  if (!appId) {
    throw new Error("Missing env var: DISCORD_APPLICATION_ID (or DISCORD_CLIENT_ID)");
  }
  return appId;
}

function parseCsvIds(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function getDiscordErrorCode(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const value = (error as { code?: unknown }).code;
  return typeof value === "number" ? value : null;
}

export async function main(): Promise<void> {
  const token = getEnv("DISCORD_TOKEN");
  if (!token) {
    throw new Error("Missing env var: DISCORD_TOKEN");
  }

  const applicationId = resolveApplicationId();
  const rest = new REST({ version: "10" }).setToken(token);

  const globalBody = globalCommands.map((command) => command.data.toJSON());
  console.log(`Deploying global commands: count=${globalBody.length}`);
  await rest.put(Routes.applicationCommands(applicationId), { body: globalBody });

  const devGuildIds = parseCsvIds(getEnv("DEV_GUILD_IDS"));
  const devGuildBody = devGuildCommands.map((command) => command.data.toJSON());

  if (devGuildIds.length === 0) {
    console.log("DEV_GUILD_IDS empty; skipping /lab deploy");
    console.log("[deploy-commands] deployment complete");
    return;
  }

  console.log(`Deploying dev guild commands: count=${devGuildBody.length} to guilds=[${devGuildIds.join(",")}]`);
  for (const guildId of devGuildIds) {
    try {
      await rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body: devGuildBody });
    } catch (error) {
      const discordCode = getDiscordErrorCode(error);
      if (discordCode === 50001) {
        console.warn(`[deploy-commands] guild=${guildId}: bot/app not installed in this guild (Discord code 50001) - skipping`);
        continue;
      }
      throw error;
    }
  }

  console.log("[deploy-commands] deployment complete");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
