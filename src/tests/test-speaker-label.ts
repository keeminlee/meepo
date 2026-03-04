import { afterEach, describe, expect, test, vi } from "vitest";

let dmUserId: string | null = null;
const byDiscordUserId = new Map<string, { canonical_name: string }>();

vi.mock("../campaign/guildConfig.js", () => ({
  getGuildDmUserId: vi.fn(() => dmUserId),
  resolveCampaignSlug: vi.fn(() => "default"),
}));

vi.mock("../registry/loadRegistry.js", () => ({
  loadRegistry: vi.fn(() => ({
    byDiscordUserId,
  })),
}));

afterEach(() => {
  dmUserId = null;
  byDiscordUserId.clear();
  vi.clearAllMocks();
  vi.resetModules();
});

describe("speaker attribution", () => {
  test("non-canon keeps discord display name", async () => {
    const { resolveSpeakerAttribution } = await import("../ledger/speakerLabel.js");

    const result = await resolveSpeakerAttribution({
      guildId: "guild-1",
      authorId: "user-1",
      discordDisplayName: "Keemin (DM)",
      canonMode: false,
    });

    expect(result).toEqual({ label: "Keemin (DM)", kind: "player" });
  });

  test("canon maps dm_user_id to DM label", async () => {
    dmUserId = "dm-1";
    const { resolveSpeakerAttribution } = await import("../ledger/speakerLabel.js");

    const result = await resolveSpeakerAttribution({
      guildId: "guild-1",
      authorId: "dm-1",
      discordDisplayName: "Keemin (DM)",
      canonMode: true,
    });

    expect(result).toEqual({ label: "DM", kind: "dm" });
  });

  test("canon maps player by discord id to canonical PC name", async () => {
    byDiscordUserId.set("user-2", { canonical_name: "Jamison" });
    const { resolveSpeakerAttribution } = await import("../ledger/speakerLabel.js");

    const result = await resolveSpeakerAttribution({
      guildId: "guild-1",
      authorId: "user-2",
      discordDisplayName: "BrassOnes",
      canonMode: true,
    });

    expect(result).toEqual({ label: "Jamison", kind: "player" });
  });

  test("canon falls back to discord display when unmapped", async () => {
    const { resolveSpeakerAttribution } = await import("../ledger/speakerLabel.js");

    const result = await resolveSpeakerAttribution({
      guildId: "guild-1",
      authorId: "user-3",
      discordDisplayName: "SomeUser",
      canonMode: true,
    });

    expect(result).toEqual({ label: "SomeUser", kind: "player" });
  });
});

describe("speaker prefix formatting", () => {
  test("does not prepend when line already has any name-style prefix", async () => {
    const { formatSpeakerLine, hasExistingSpeakerPrefix } = await import("../ledger/speakerLabel.js");

    expect(hasExistingSpeakerPrefix("Keemin (DM): Roll initiative")).toBe(true);
    expect(formatSpeakerLine("DM", "Keemin (DM): Roll initiative")).toBe("Keemin (DM): Roll initiative");
  });

  test("prepends label when line has no speaker prefix", async () => {
    const { formatSpeakerLine, hasExistingSpeakerPrefix } = await import("../ledger/speakerLabel.js");

    expect(hasExistingSpeakerPrefix("Roll initiative")).toBe(false);
    expect(formatSpeakerLine("DM", "Roll initiative")).toBe("DM: Roll initiative");
  });
});
