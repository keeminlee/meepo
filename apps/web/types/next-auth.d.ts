import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user?: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      globalName?: string | null;
    };
    discord?: {
      guilds: Array<{
        id: string;
        name: string;
        icon: string | null;
        permissions?: string;
      }>;
      source?: "session_snapshot" | "discord_refresh" | "session_snapshot_fallback";
      lastSyncedAtMs?: number | null;
      lastRefreshAttemptAtMs?: number | null;
      ttlMs?: number;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    discordUserId?: string;
    discordAccessToken?: string;
    discordGlobalName?: string;
    discordGuilds?: Array<{
      id: string;
      name: string;
      icon: string | null;
      permissions?: string;
    }>;
    discordGuildsSource?: "session_snapshot" | "discord_refresh" | "session_snapshot_fallback";
    discordGuildsLastSyncedAtMs?: number | null;
    discordGuildsLastRefreshAttemptAtMs?: number | null;
    discordGuildsTtlMs?: number;
  }
}
