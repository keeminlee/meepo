import { afterEach, describe, expect, test, vi } from "vitest";
import { PermissionFlagsBits } from "discord.js";

const accessState = vi.hoisted(() => ({
  devUserIds: ["dev-user"] as string[],
  dmUserIds: [] as string[],
}));

const discordState = vi.hoisted(() => ({
  dmRoleId: "legacy-dm-role" as string | undefined,
}));

const guildState = vi.hoisted(() => ({
  dmRoleByGuild: new Map<string, string | null>(),
  dmUserByGuild: new Map<string, string | null>(),
}));

const listSessionsForAutocompleteMock = vi.hoisted(() =>
  vi.fn(() => [{ name: "Session One", value: "s1" }])
);

vi.mock("../config/env.js", () => ({
  cfg: {
    logging: { level: "warn", scopes: [], format: "pretty" },
    access: accessState,
    discord: discordState,
  },
}));

vi.mock("../campaign/guildConfig.js", () => ({
  getGuildDmRoleId: vi.fn((guildId: string) => guildState.dmRoleByGuild.get(guildId) ?? null),
  getGuildDmUserId: vi.fn((guildId: string) => guildState.dmUserByGuild.get(guildId) ?? null),
  resolveCampaignSlug: vi.fn(() => "default"),
}));

vi.mock("../commands/shared/sessionResolve.js", () => ({
  listSessionsForAutocomplete: listSessionsForAutocompleteMock,
  resolveSessionSelection: vi.fn(() => null),
  listAnchorsForAutocomplete: vi.fn(() => []),
  resolveLatestUserAnchorLedgerId: vi.fn(),
}));

vi.mock("../sessions/sessions.js", () => ({
  getActiveSession: vi.fn(() => null),
  startSession: vi.fn(),
}));

vi.mock("../db.js", () => ({
  getDbForCampaign: vi.fn(() => ({ prepare: vi.fn() })),
}));

const stubLegacyCommand = {
  data: {
    toJSON: () => ({
      name: "stub",
      description: "stub",
      options: [
        {
          type: 1,
          name: "run",
          description: "run",
          options: [],
        },
      ],
    }),
  },
  execute: vi.fn(async () => {}),
};

vi.mock("../commands/meepoLegacy.js", () => ({ meepo: stubLegacyCommand }));
vi.mock("../commands/meepo.js", () => ({
  executeLabAwakenRespond: vi.fn(async () => {}),
  executeLabDoctor: vi.fn(async () => {}),
  executeLabSleep: vi.fn(async () => {}),
}));
vi.mock("../commands/session.js", () => ({ session: stubLegacyCommand }));
vi.mock("../commands/meeps.js", () => ({ meeps: stubLegacyCommand }));
vi.mock("../commands/missions.js", () => ({ missions: stubLegacyCommand }));
vi.mock("../commands/goldmem.js", () => ({ goldmem: stubLegacyCommand }));

afterEach(() => {
  accessState.devUserIds = ["dev-user"];
  accessState.dmUserIds = [];
  discordState.dmRoleId = "legacy-dm-role";
  guildState.dmRoleByGuild.clear();
  guildState.dmUserByGuild.clear();
  listSessionsForAutocompleteMock.mockClear();
  vi.clearAllMocks();
  vi.resetModules();
});

describe("elevated access resolver", () => {
  test("admin user is allowed for dm surface", async () => {
    const { hasGuildOperationalAccess } = await import("../auth/resolveElevatedAccess.js");

    const allowed = hasGuildOperationalAccess({
      guildId: "g1",
      userId: "u-admin",
      member: {
        id: "u-admin",
        guild: { ownerId: "guild-owner" },
        permissions: {
          has: (permission: bigint) => permission === PermissionFlagsBits.Administrator,
        },
        roles: [],
      },
    });

    expect(allowed).toBe(true);
  });

  test("guild dm role member is allowed for dm surface", async () => {
    guildState.dmRoleByGuild.set("g1", "role-dm");
    const { hasGuildOperationalAccess } = await import("../auth/resolveElevatedAccess.js");

    const allowed = hasGuildOperationalAccess({
      guildId: "g1",
      userId: "u-role",
      member: {
        id: "u-role",
        guild: { ownerId: "guild-owner" },
        permissions: { has: () => false },
        roles: ["role-dm"],
      },
    });

    expect(allowed).toBe(true);
  });

  test("DM_USER_IDS allowlisted user is allowed for dm surface", async () => {
    accessState.dmUserIds = ["u-allow"]; 
    const { hasGuildOperationalAccess } = await import("../auth/resolveElevatedAccess.js");

    const allowed = hasGuildOperationalAccess({
      guildId: "g1",
      userId: "u-allow",
      member: {
        id: "u-allow",
        guild: { ownerId: "guild-owner" },
        permissions: { has: () => false },
        roles: [],
      },
    });

    expect(allowed).toBe(true);
  });

  test("normal user is denied for dm surface", async () => {
    const { hasGuildOperationalAccess } = await import("../auth/resolveElevatedAccess.js");

    const allowed = hasGuildOperationalAccess({
      guildId: "g1",
      userId: "u-normal",
      member: {
        id: "u-normal",
        guild: { ownerId: "guild-owner" },
        permissions: { has: () => false },
        roles: [],
      },
    });

    expect(allowed).toBe(false);
  });

  test("dev surface remains DEV_USER_IDS only", async () => {
    accessState.devUserIds = ["u-dev"];
    accessState.dmUserIds = ["u-dm-only"];
    const { isElevatedForSurface } = await import("../auth/resolveElevatedAccess.js");

    expect(
      isElevatedForSurface("dev", { guildId: "g1", userId: "u-dev", member: null })
    ).toBe(true);
    expect(
      isElevatedForSurface("dev", { guildId: "g1", userId: "u-dm-only", member: null })
    ).toBe(false);
  });
});

describe("lab autocomplete visibility", () => {
  test("non-dev user gets empty autocomplete results", async () => {
    const { lab } = await import("../commands/lab.js");

    const respond = vi.fn(async () => {});
    await lab.autocomplete({
      user: { id: "not-dev" },
      guildId: "g1",
      guild: { name: "Guild" },
      channelId: "c1",
      options: {
        getFocused: () => ({ name: "session", value: "arena" }),
        getSubcommandGroup: () => "actions",
        getSubcommand: () => "tail",
      },
      respond,
    });

    expect(listSessionsForAutocompleteMock).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith([]);
  });
});
