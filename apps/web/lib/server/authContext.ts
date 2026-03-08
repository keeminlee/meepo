import { headers } from "next/headers";

export type WebAuthorizedGuild = {
  id: string;
  name?: string;
  iconUrl?: string;
};

export type WebAuthUser = {
  id: string;
  name: string | null;
  globalName: string | null;
};

export type WebAuthContext = {
  kind: "authenticated" | "fallback";
  source: "session_snapshot" | "discord_refresh" | "session_snapshot_fallback" | "header" | "query";
  user: WebAuthUser | null;
  authorizedGuildIds: string[];
  authorizedGuilds: WebAuthorizedGuild[];
  primaryGuildId: string | null;
  devBypass: boolean;
};

export class WebAuthError extends Error {
  readonly code = "UNAUTHORIZED" as const;
  readonly status = 401;
  readonly reason: "unsigned" | "invalid_session";

  constructor(message: string, reason: "unsigned" | "invalid_session" = "unsigned") {
    super(message);
    this.name = "WebAuthError";
    this.reason = reason;
  }
}

type ResolveAuthInputs = {
  headerGuild: string | null;
  searchParams?: Record<string, string | string[] | undefined>;
  bypassFlag?: string | null;
  nodeEnv?: string | null;
  sessionUser?: WebAuthUser | null;
  sessionGuilds?: Array<{
    id: string;
    name?: string;
    icon?: string | null;
    iconUrl?: string;
  }>;
  sessionSource?: "session_snapshot" | "discord_refresh" | "session_snapshot_fallback";
};

function toDiscordIconUrl(guildId: string, icon: string | null | undefined): string | undefined {
  if (!icon || icon.trim().length === 0) return undefined;
  return `https://cdn.discordapp.com/icons/${guildId}/${icon}.png`;
}

function toSessionAuthorizedGuilds(inputGuilds: ResolveAuthInputs["sessionGuilds"]): WebAuthorizedGuild[] {
  const seen = new Set<string>();
  const out: WebAuthorizedGuild[] = [];
  for (const guild of inputGuilds ?? []) {
    const id = guild.id?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const name = guild.name?.trim();
    const iconUrl = guild.iconUrl ?? toDiscordIconUrl(id, guild.icon);
    out.push({
      id,
      ...(name ? { name } : {}),
      ...(iconUrl ? { iconUrl } : {}),
    });
  }
  return out;
}

function createFallbackContext(args: {
  guildId: string;
  source: "header" | "query";
  devBypass: boolean;
}): WebAuthContext {
  return {
    kind: "fallback",
    source: args.source,
    user: null,
    authorizedGuildIds: [args.guildId],
    authorizedGuilds: [{ id: args.guildId }],
    primaryGuildId: args.guildId,
    devBypass: args.devBypass,
  };
}

function normalizeQueryValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return (value[0] ?? "").trim() || null;
  }
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function resolveWebAuthContextFromInputs(input: ResolveAuthInputs): WebAuthContext {
  const environment = (input.nodeEnv ?? process.env.NODE_ENV ?? "development").trim();
  const isDevelopment = environment !== "production";
  const bypassEnabled = isDevelopment && (input.bypassFlag ?? process.env.DEV_WEB_BYPASS) === "1";

  if (input.sessionUser?.id) {
    const authorizedGuilds = toSessionAuthorizedGuilds(input.sessionGuilds);
    return {
      kind: "authenticated",
      source: input.sessionSource ?? "session_snapshot",
      user: input.sessionUser,
      authorizedGuildIds: authorizedGuilds.map((guild) => guild.id),
      authorizedGuilds,
      primaryGuildId: authorizedGuilds[0]?.id ?? null,
      devBypass: false,
    };
  }

  const headerGuild = input.headerGuild?.trim() || null;
  if (headerGuild) {
    if (!bypassEnabled) {
      throw new WebAuthError("Guild header override requires development mode with DEV_WEB_BYPASS=1.");
    }
    return createFallbackContext({ guildId: headerGuild, source: "header", devBypass: true });
  }

  const queryGuild = normalizeQueryValue(input.searchParams?.guildId) ?? normalizeQueryValue(input.searchParams?.guild);
  if (queryGuild) {
    if (!bypassEnabled) {
      throw new WebAuthError("Guild query override requires development mode with DEV_WEB_BYPASS=1.");
    }
    return createFallbackContext({ guildId: queryGuild, source: "query", devBypass: true });
  }

  throw new WebAuthError("Sign-in required. In local development, enable DEV_WEB_BYPASS=1 and provide header/query guild override.");
}

export async function resolveWebAuthContext(searchParams?: Record<string, string | string[] | undefined>): Promise<WebAuthContext> {
  const headerStore = await headers();
  const { getAuthSession } = await import("./getAuthSession");
  const session = await getAuthSession();

  if (session?.user && !session.user.id) {
    throw new WebAuthError(
      "Authenticated session is missing user.id. Check NextAuth session callback mapping.",
      "invalid_session"
    );
  }

  const sessionUser = session?.user?.id
    ? {
        id: session.user.id,
        name: session.user.name ?? null,
        globalName: session.user.globalName ?? null,
      }
    : null;

  return resolveWebAuthContextFromInputs({
    headerGuild: headerStore.get("x-meepo-guild-id"),
    searchParams,
    bypassFlag: process.env.DEV_WEB_BYPASS,
    nodeEnv: process.env.NODE_ENV,
    sessionUser,
    sessionGuilds: session?.discord?.guilds,
    sessionSource: session?.discord?.source,
  });
}
