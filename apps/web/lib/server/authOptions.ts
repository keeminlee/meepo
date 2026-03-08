import type { NextAuthOptions } from "next-auth";
import DiscordProvider from "next-auth/providers/discord";
import {
  isGuildSnapshotStale,
  resolveGuildSnapshotTtlMs,
  toRefreshFailureMeta,
  toSnapshotMeta,
  type DiscordGuildSnapshotSource,
} from "@/lib/server/discordGuildSnapshotCache";

type DiscordGuild = {
  id: string;
  name: string;
  icon: string | null;
  permissions?: string;
};

type NextAuthOptionsWithTrustHost = NextAuthOptions & {
  trustHost: true;
};

const isProduction = process.env.NODE_ENV === "production";
const securePrefix = isProduction ? "__Secure-" : "";

function resolveProductionCookieDomain(): string | undefined {
  if (!isProduction) return undefined;

  const rawUrl = process.env.NEXTAUTH_URL ?? process.env.AUTH_URL;
  if (!rawUrl) return undefined;

  try {
    const hostname = new URL(rawUrl).hostname.trim().toLowerCase();
    if (!hostname || hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
      return undefined;
    }
    return hostname;
  } catch {
    return undefined;
  }
}

const productionCookieDomain = resolveProductionCookieDomain();
const csrfPrefix = isProduction && !productionCookieDomain ? "__Host-" : securePrefix;
const cookieSameSite = isProduction ? "none" : "lax";

async function fetchDiscordGuilds(accessToken: string): Promise<DiscordGuild[]> {
  const response = await fetch("https://discord.com/api/users/@me/guilds", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Discord guild refresh failed with status ${response.status}`);
  }

  const payload = (await response.json()) as Array<{
    id: string;
    name: string;
    icon: string | null;
    permissions?: string;
  }>;

  return payload.map((guild) => ({
    id: guild.id,
    name: guild.name,
    icon: guild.icon,
    permissions: guild.permissions,
  }));
}

async function fetchDiscordGuildsSafe(accessToken: string): Promise<{ ok: boolean; guilds: DiscordGuild[] }> {
  try {
    const guilds = await fetchDiscordGuilds(accessToken);
    return { ok: true, guilds };
  } catch {
    return { ok: false, guilds: [] };
  }
}

export const authOptions: NextAuthOptionsWithTrustHost = {
  trustHost: true,
  useSecureCookies: isProduction,
  cookies: {
    state: {
      name: `${securePrefix}next-auth.state`,
      options: {
        httpOnly: true,
        sameSite: cookieSameSite,
        path: "/",
        secure: isProduction,
        maxAge: 900,
        ...(productionCookieDomain ? { domain: productionCookieDomain } : {}),
      },
    },
    callbackUrl: {
      name: `${securePrefix}next-auth.callback-url`,
      options: {
        sameSite: cookieSameSite,
        path: "/",
        secure: isProduction,
        ...(productionCookieDomain ? { domain: productionCookieDomain } : {}),
      },
    },
    csrfToken: {
      name: `${csrfPrefix}next-auth.csrf-token`,
      options: {
        httpOnly: true,
        sameSite: cookieSameSite,
        path: "/",
        secure: isProduction,
        ...(productionCookieDomain ? { domain: productionCookieDomain } : {}),
      },
    },
  },
  session: {
    strategy: "jwt",
  },
  providers: [
    DiscordProvider({
      clientId: process.env.DISCORD_CLIENT_ID ?? "",
      clientSecret: process.env.DISCORD_CLIENT_SECRET ?? "",
      authorization: {
        params: {
          scope: "identify guilds",
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      const nowMs = Date.now();
      const ttlMs = resolveGuildSnapshotTtlMs(process.env.MEEPO_WEB_DISCORD_GUILDS_TTL_MS);
      const previousLastSyncedAtMs =
        typeof token.discordGuildsLastSyncedAtMs === "number" ? token.discordGuildsLastSyncedAtMs : null;

      if (account?.provider === "discord") {
        token.discordUserId = account.providerAccountId;
        token.discordAccessToken = account.access_token;

        if (account.access_token) {
          const result = await fetchDiscordGuildsSafe(account.access_token);
          if (result.ok) {
            token.discordGuilds = result.guilds;
            token.discordGuildsSource = "discord_refresh";
            token.discordGuildsLastSyncedAtMs = nowMs;
            token.discordGuildsLastRefreshAttemptAtMs = nowMs;
            token.discordGuildsTtlMs = ttlMs;
          } else {
            const failureMeta = toRefreshFailureMeta({
              previousLastSyncedAtMs,
              nowMs,
              ttlMs,
            });
            token.discordGuildsSource = failureMeta.source;
            token.discordGuildsLastSyncedAtMs = failureMeta.lastSyncedAtMs;
            token.discordGuildsLastRefreshAttemptAtMs = failureMeta.lastRefreshAttemptAtMs;
            token.discordGuildsTtlMs = failureMeta.ttlMs;
          }
        }
      } else if (typeof token.discordAccessToken === "string" && token.discordAccessToken.trim().length > 0) {
        const stale = isGuildSnapshotStale({
          nowMs,
          lastSyncedAtMs: previousLastSyncedAtMs,
          ttlMs,
        });

        if (stale) {
          const result = await fetchDiscordGuildsSafe(token.discordAccessToken);
          if (result.ok) {
            token.discordGuilds = result.guilds;
            token.discordGuildsSource = "discord_refresh";
            token.discordGuildsLastSyncedAtMs = nowMs;
            token.discordGuildsLastRefreshAttemptAtMs = nowMs;
            token.discordGuildsTtlMs = ttlMs;
          } else {
            const failureMeta = toRefreshFailureMeta({
              previousLastSyncedAtMs,
              nowMs,
              ttlMs,
            });
            token.discordGuildsSource = failureMeta.source;
            token.discordGuildsLastSyncedAtMs = failureMeta.lastSyncedAtMs;
            token.discordGuildsLastRefreshAttemptAtMs = failureMeta.lastRefreshAttemptAtMs;
            token.discordGuildsTtlMs = failureMeta.ttlMs;
          }
        } else {
          const snapshotMeta = toSnapshotMeta({
            source: "session_snapshot",
            ttlMs,
            lastSyncedAtMs: previousLastSyncedAtMs,
            lastRefreshAttemptAtMs:
              typeof token.discordGuildsLastRefreshAttemptAtMs === "number"
                ? token.discordGuildsLastRefreshAttemptAtMs
                : null,
          });
          token.discordGuildsSource = snapshotMeta.source;
          token.discordGuildsLastSyncedAtMs = snapshotMeta.lastSyncedAtMs;
          token.discordGuildsLastRefreshAttemptAtMs = snapshotMeta.lastRefreshAttemptAtMs;
          token.discordGuildsTtlMs = snapshotMeta.ttlMs;
        }
      } else {
        const snapshotMeta = toSnapshotMeta({
          source: "session_snapshot",
          ttlMs,
          lastSyncedAtMs: previousLastSyncedAtMs,
          lastRefreshAttemptAtMs:
            typeof token.discordGuildsLastRefreshAttemptAtMs === "number"
              ? token.discordGuildsLastRefreshAttemptAtMs
              : null,
        });
        token.discordGuildsSource = snapshotMeta.source;
        token.discordGuildsLastSyncedAtMs = snapshotMeta.lastSyncedAtMs;
        token.discordGuildsLastRefreshAttemptAtMs = snapshotMeta.lastRefreshAttemptAtMs;
        token.discordGuildsTtlMs = snapshotMeta.ttlMs;
      }

      if (profile && typeof profile === "object") {
        const maybeGlobalName = (profile as { global_name?: unknown }).global_name;
        if (typeof maybeGlobalName === "string" && maybeGlobalName.trim().length > 0) {
          token.discordGlobalName = maybeGlobalName;
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = typeof token.discordUserId === "string" ? token.discordUserId : "";
        session.user.globalName = typeof token.discordGlobalName === "string" ? token.discordGlobalName : null;
      }

      const source: DiscordGuildSnapshotSource =
        token.discordGuildsSource === "discord_refresh" || token.discordGuildsSource === "session_snapshot_fallback"
          ? token.discordGuildsSource
          : "session_snapshot";

      session.discord = {
        guilds: Array.isArray(token.discordGuilds) ? token.discordGuilds : [],
        source,
        lastSyncedAtMs: typeof token.discordGuildsLastSyncedAtMs === "number" ? token.discordGuildsLastSyncedAtMs : null,
        lastRefreshAttemptAtMs:
          typeof token.discordGuildsLastRefreshAttemptAtMs === "number" ? token.discordGuildsLastRefreshAttemptAtMs : null,
        ttlMs:
          typeof token.discordGuildsTtlMs === "number"
            ? token.discordGuildsTtlMs
            : resolveGuildSnapshotTtlMs(process.env.MEEPO_WEB_DISCORD_GUILDS_TTL_MS),
      };

      return session;
    },
  },
  secret: process.env.AUTH_SECRET,
};
