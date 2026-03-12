import { afterEach, describe, expect, test, vi } from "vitest";

const stubLegacyCommand = {
  data: {
    toJSON: () => ({
      name: "stub",
      description: "stub",
      options: [{ type: 1, name: "run", description: "run", options: [] }],
    }),
  },
  execute: vi.fn(async () => {}),
};

vi.mock("../../commands/meepo.js", async () => {
  const actual = await vi.importActual<any>("../../commands/meepo.js");
  return {
    ...actual,
    executeLabAwakenRespond: vi.fn(async () => {}),
    executeLabDoctor: vi.fn(async () => {}),
    executeLabSleep: vi.fn(async () => {}),
  };
});
vi.mock("../../commands/meepoLegacy.js", () => ({ meepo: stubLegacyCommand }));
vi.mock("../../commands/session.js", () => ({ session: stubLegacyCommand }));
vi.mock("../../commands/meeps.js", () => ({ meeps: stubLegacyCommand }));
vi.mock("../../commands/missions.js", () => ({ missions: stubLegacyCommand }));
vi.mock("../../commands/goldmem.js", () => ({ goldmem: stubLegacyCommand }));

function stubCoreEnv(): void {
  vi.stubEnv("DISCORD_TOKEN", "test-token");
  vi.stubEnv("OPENAI_API_KEY", "test-openai");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Phase 1A command manifests", () => {
  test("/meepo exposes only the clean minimal surface", async () => {
    stubCoreEnv();
    const { meepo } = await import("../../commands/meepo.js");
    const data = meepo.data.toJSON();

    const options = (data.options ?? []) as any[];
    const optionNames = options.map((option) => option.name).sort();
    expect(optionNames).toEqual(["awaken", "help", "hush", "sessions", "settings", "showtime", "status", "talk"]);

    const showtimeGroup = options.find((option) => option.name === "showtime") as any;
    expect(showtimeGroup).toBeTruthy();
    expect(showtimeGroup.type).toBe(2);

    const showtimeSubcommands = (showtimeGroup.options ?? []).map((option: any) => option.name).sort();
    expect(showtimeSubcommands).toEqual(["end", "start"]);

    const showtimeStart = (showtimeGroup.options ?? []).find((option: any) => option.name === "start") as any;
    expect(showtimeStart).toBeTruthy();

    const showtimeStartOptionNames = (showtimeStart.options ?? []).map((option: any) => option.name).sort();
    expect(showtimeStartOptionNames).toEqual(["campaign", "campaign_name"]);

    const settingsGroup = options.find((option) => option.name === "settings") as any;
    expect(settingsGroup).toBeTruthy();
    expect(settingsGroup.type).toBe(2);

    const settingsSubcommands = (settingsGroup.options ?? []).map((option: any) => option.name).sort();
    expect(settingsSubcommands).toEqual([
      "dm_name",
      "dm_role",
      "home_text_channel",
      "home_voice_channel",
      "show",
      "talk_mode",
    ]);
  });

  test("/lab exists and contains legacy families", async () => {
    stubCoreEnv();
    const { lab } = await import("../../commands/lab.js");
    const data = lab.data.toJSON();

    const options = (data.options ?? []) as any[];
    const directSubcommands = options.filter((option: any) => option.type === 1).map((option: any) => option.name).sort();
    expect(directSubcommands).toEqual(["doctor", "sleep"]);

    const groups = options.filter((option: any) => option.type === 2);
    const groupNames = groups.map((group: any) => group.name).sort();
    expect(groupNames).toEqual(["actions", "awaken", "goldmem", "meepo", "meeps", "missions", "prompt", "session", "wake"]);

    for (const group of groups) {
      const subcommands = group.options ?? [];
      expect(subcommands.length).toBeGreaterThan(0);
      for (const subcommand of subcommands) {
        expect(subcommand.type).toBe(1);
      }
    }
  });
});
