import { afterEach, describe, expect, test, vi } from "vitest";

const accessState = vi.hoisted(() => ({ devUserIds: ["dev-user"] as string[] }));

vi.mock("../config/env.js", () => ({
  cfg: {
    logging: { level: "warn", scopes: [], format: "pretty" },
    voice: { debug: false },
    data: { root: ".", campaignsDir: "campaigns" },
    mode: "ambient",
    access: accessState,
  },
}));

const stubLegacyCommand = {
  data: {
    name: "stub",
    toJSON: () => ({
      name: "stub",
      description: "stub",
      options: [{ type: 1, name: "run", description: "run", options: [] }],
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
vi.mock("../campaign/guildConfig.js", () => ({
  resolveCampaignSlug: vi.fn(() => "default"),
}));
vi.mock("../db.js", () => ({
  getDbForCampaign: vi.fn(() => ({ prepare: vi.fn() })),
}));

afterEach(() => {
  accessState.devUserIds = ["dev-user"];
  vi.clearAllMocks();
  vi.resetModules();
});

describe("lab gating contract", () => {
  test("/lab execute denies non-dev user", async () => {
    accessState.devUserIds = ["dev-user"];
    const { lab } = await import("../commands/lab.js");
    const reply = vi.fn(async () => {});

    await lab.execute(
      {
        user: { id: "not-dev" },
        options: {
          getSubcommandGroup: () => "actions",
          getSubcommand: () => "tail",
        },
        reply,
      } as any,
      null
    );

    expect(reply).toHaveBeenCalledTimes(1);
    const firstCall = (reply as any).mock?.calls?.[0] as [unknown] | undefined;
    const payload = (firstCall?.[0] ?? {}) as { content?: string; ephemeral?: boolean };
    expect(payload.ephemeral).toBe(true);
    expect(typeof payload.content).toBe("string");
    expect((payload.content ?? "").length).toBeGreaterThan(0);
  });

  test("/lab execute allows dev user through gate", async () => {
    accessState.devUserIds = ["dev-user"];
    const { lab } = await import("../commands/lab.js");
    const reply = vi.fn(async () => {});

    await lab.execute(
      {
        user: { id: "dev-user" },
        options: {
          getSubcommandGroup: () => "unknown",
          getSubcommand: () => "noop",
        },
        reply,
      } as any,
      null
    );

    expect(reply).toHaveBeenCalledWith({
      content: "Unknown /lab family: unknown",
      ephemeral: true,
    });
  });
});
