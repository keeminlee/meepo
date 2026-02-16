import { Guild } from "discord.js";
import { log } from "../utils/logger.js";

const meepoLog = log.withScope("meepo");

/**
 * Set bot nickname based on active persona
 * @param guild - The Discord guild
 * @param personaId - The persona ID (e.g., "meepo", "xoblob")
 */
export async function setBotNicknameForPersona(guild: Guild, personaId: string): Promise<void> {
  try {
    let nickname: string;
    if (personaId === "xoblob") {
      nickname = "Xoblob (Echo)";
    } else if (personaId === "meepo") {
      nickname = "Meepo";
    } else {
      // Unknown persona, default to Meepo
      nickname = "Meepo";
    }

    // Fetch guild member if not cached
    if (!guild.members.me) {
      await guild.members.fetch(guild.client.user!.id);
    }

    if (guild.members.me) {
      await guild.members.me.setNickname(nickname);
      meepoLog.debug(`Nickname set to: ${nickname} (persona: ${personaId})`);
    } else {
      meepoLog.warn("Could not fetch bot guild member for nickname change");
    }
  } catch (err: any) {
    // Log but don't crash - missing permissions or role hierarchy issues
    meepoLog.warn(`Failed to set nickname: ${err.message}`);
  }
}
