import { afterEach, describe, expect, test, vi } from "vitest";

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
    expect(optionNames).toEqual(["doctor", "help", "hush", "sessions", "settings", "sleep", "status", "talk", "wake"]);

    const settingsGroup = options.find((option) => option.name === "settings") as any;
    expect(settingsGroup).toBeTruthy();
    expect(settingsGroup.type).toBe(2);

    const settingsSubcommands = (settingsGroup.options ?? []).map((option: any) => option.name).sort();
    expect(settingsSubcommands).toEqual(["clear", "set", "show"]);
  });

  test("/lab exists and contains legacy families", async () => {
    stubCoreEnv();
    const { lab } = await import("../../commands/lab.js");
    const data = lab.data.toJSON();

    const groups = (data.options ?? []) as any[];
    const groupNames = groups.map((group: any) => group.name).sort();
    expect(groupNames).toEqual(["actions", "goldmem", "meepo", "meeps", "missions", "prompt", "session", "wake"]);

    for (const group of groups) {
      expect(group.type).toBe(2);
      const subcommands = group.options ?? [];
      expect(subcommands.length).toBeGreaterThan(0);
      for (const subcommand of subcommands) {
        expect(subcommand.type).toBe(1);
      }
    }
  });
});
