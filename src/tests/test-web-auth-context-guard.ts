import { describe, expect, it } from "vitest";
import { resolveWebAuthContextFromInputs, WebAuthError } from "../../apps/web/lib/server/authContext";

describe("web auth context guard", () => {
  it("rejects query override when bypass gate is disabled", () => {
    expect(() =>
      resolveWebAuthContextFromInputs({
        headerGuild: null,
        searchParams: { guildId: "guild-test" },
        bypassFlag: "0",
        nodeEnv: "development",
      })
    ).toThrow(WebAuthError);
  });

  it("allows query override only in development with bypass gate", () => {
    const context = resolveWebAuthContextFromInputs({
      headerGuild: null,
      searchParams: { guildId: "guild-dev" },
      bypassFlag: "1",
      nodeEnv: "development",
    });

    expect(context.primaryGuildId).toBe("guild-dev");
    expect(context.authorizedGuildIds).toEqual(["guild-dev"]);
    expect(context.source).toBe("query");
    expect(context.devBypass).toBe(true);
  });

  it("rejects header override in production even when bypass flag is set", () => {
    expect(() =>
      resolveWebAuthContextFromInputs({
        headerGuild: "guild-prod",
        searchParams: {},
        bypassFlag: "1",
        nodeEnv: "production",
      })
    ).toThrow(WebAuthError);
  });

  it("resolves authorized guild IDs from session snapshot", () => {
    const context = resolveWebAuthContextFromInputs({
      headerGuild: null,
      searchParams: {},
      bypassFlag: "0",
      nodeEnv: "development",
      sessionUser: {
        id: "user-1",
        name: "Tester",
        globalName: "TesterGlobal",
      },
      sessionGuilds: [
        {
          id: "guild-a",
          name: "Guild A",
          icon: "abc123",
        },
      ],
      sessionSource: "discord_refresh",
    });

    expect(context.kind).toBe("authenticated");
    expect(context.source).toBe("discord_refresh");
    expect(context.authorizedGuildIds).toEqual(["guild-a"]);
    expect(context.authorizedGuilds[0]?.id).toBe("guild-a");
    expect(context.authorizedGuilds[0]?.name).toBe("Guild A");
    expect(context.authorizedGuilds[0]?.iconUrl).toContain("cdn.discordapp.com/icons/guild-a/abc123");
  });

  it("prefers session snapshot over dev bypass overrides", () => {
    const context = resolveWebAuthContextFromInputs({
      headerGuild: "guild-dev-bypass",
      searchParams: { guildId: "guild-dev-query" },
      bypassFlag: "1",
      nodeEnv: "development",
      sessionUser: {
        id: "user-2",
        name: "Tester 2",
        globalName: null,
      },
      sessionGuilds: [{ id: "guild-session", name: "Session Guild" }],
    });

    expect(context.source).toBe("session_snapshot");
    expect(context.authorizedGuildIds).toEqual(["guild-session"]);
    expect(context.primaryGuildId).toBe("guild-session");
  });
});
