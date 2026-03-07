import { beforeEach, describe, expect, test } from "vitest";

process.env.DISCORD_TOKEN ??= "test-token";
process.env.OPENAI_API_KEY ??= "test-openai-key";

async function getLogDedupeHelpers() {
  const mod = await import("../campaign/guildConfig.js");
  return {
    getNoGuildFallbackLogLevel: mod.getNoGuildFallbackLogLevel,
    resetNoGuildFallbackLogDedupeForTests: mod.resetNoGuildFallbackLogDedupeForTests,
  };
}

describe("campaign fallback log dedupe", () => {
  beforeEach(() => {
    // Reset process-local dedupe state before each assertion.
    return getLogDedupeHelpers().then(({ resetNoGuildFallbackLogDedupeForTests }) => {
      resetNoGuildFallbackLogDedupeForTests();
    });
  });

  test("logs info only once per campaign slug", async () => {
    const { getNoGuildFallbackLogLevel } = await getLogDedupeHelpers();
    expect(getNoGuildFallbackLogLevel("homebrew_campaign_2")).toBe("info");
    expect(getNoGuildFallbackLogLevel("homebrew_campaign_2")).toBe("debug");
    expect(getNoGuildFallbackLogLevel("homebrew_campaign_2")).toBe("debug");
  });

  test("emits fresh info when fallback campaign slug changes", async () => {
    const { getNoGuildFallbackLogLevel } = await getLogDedupeHelpers();
    expect(getNoGuildFallbackLogLevel("homebrew_campaign_2")).toBe("info");
    expect(getNoGuildFallbackLogLevel("pan_pan_land")).toBe("info");
    expect(getNoGuildFallbackLogLevel("pan_pan_land")).toBe("debug");
  });
});
