import { describe, expect, test, vi } from "vitest";

const listSessionsForAutocompleteMock = vi.fn(() => [
  { name: "2026-03-04 20:12 • #— • Arena Night 12", value: "s1" },
]);
const resolveSessionSelectionMock = vi.fn(() => ({
  sessionId: "s1",
  usedDefault: true,
  displayName: "2026-03-04 20:12 • #— • Arena Night 12",
}));
const listAnchorsForAutocompleteMock = vi.fn(() => [
  { name: "134 — \"where are we headed next?\"", value: "134" },
]);

vi.mock("../commands/shared/sessionResolve.js", () => ({
  listSessionsForAutocomplete: listSessionsForAutocompleteMock,
  resolveSessionSelection: resolveSessionSelectionMock,
  listAnchorsForAutocomplete: listAnchorsForAutocompleteMock,
  resolveLatestUserAnchorLedgerId: vi.fn(),
}));

vi.mock("../config/env.js", () => ({
  cfg: {
    logging: { level: "warn", scopes: [], format: "pretty" },
    features: { labCommandsEnabled: true },
    access: { devUserIds: [], devGuildIds: [] },
  },
}));

vi.mock("../sessions/sessions.js", () => ({
  getActiveSession: vi.fn(() => null),
  startSession: vi.fn(),
}));

vi.mock("../campaign/guildConfig.js", () => ({
  resolveCampaignSlug: vi.fn(() => "default"),
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
vi.mock("../commands/session.js", () => ({ session: stubLegacyCommand }));
vi.mock("../commands/meeps.js", () => ({ meeps: stubLegacyCommand }));
vi.mock("../commands/missions.js", () => ({ missions: stubLegacyCommand }));
vi.mock("../commands/goldmem.js", () => ({ goldmem: stubLegacyCommand }));

describe("lab autocomplete routing", () => {
  test("routes session autocomplete through shared session resolver", async () => {
    const { lab } = await import("../commands/lab.js");

    const respond = vi.fn(async () => {});
    await lab.autocomplete({
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

    expect(listSessionsForAutocompleteMock).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith([{ name: "2026-03-04 20:12 • #— • Arena Night 12", value: "s1" }]);
  });

  test("routes anchor autocomplete through shared anchor resolver", async () => {
    const { lab } = await import("../commands/lab.js");

    const respond = vi.fn(async () => {});
    await lab.autocomplete({
      guildId: "g1",
      guild: { name: "Guild" },
      channelId: "c1",
      options: {
        getFocused: () => ({ name: "anchor", value: "134" }),
        getSubcommandGroup: () => "prompt",
        getSubcommand: () => "inspect",
        getString: () => null,
      },
      respond,
    });

    expect(resolveSessionSelectionMock).toHaveBeenCalledTimes(1);
    expect(listAnchorsForAutocompleteMock).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith([
      { name: "latest", value: "latest" },
      { name: "134 — \"where are we headed next?\"", value: "134" },
    ]);
  });
});
