import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { InteractionType } from "discord.js";
import { afterEach, describe, expect, test, vi } from "vitest";

process.env.DISCORD_TOKEN ??= "test-token";
process.env.OPENAI_API_KEY ??= "test-openai-key";

const tempDirs: string[] = [];
const ensureBronzeTranscriptExportCachedMock = vi.fn(() => ({ cacheHit: false }));
const generateSessionRecapMock = vi.fn(async () => ({
  concise: "",
  balanced: "Generated recap",
  detailed: "",
  engine: "megameecap",
  source_hash: "hash-1",
  strategy_version: "session-recaps-v2",
  meta_json: JSON.stringify({
    model_version: "session-recaps-v2",
    styles: {
      concise: { cacheHit: false, sourceHash: "hash-1" },
      balanced: { cacheHit: false, sourceHash: "hash-1" },
      detailed: { cacheHit: false, sourceHash: "hash-1" },
    },
  }),
  generated_at_ms: Date.now(),
  created_at_ms: Date.now(),
  updated_at_ms: Date.now(),
  source: "canonical",
}));
const joinVoiceMock = vi.fn();
const leaveVoiceMock = vi.fn();
const stopReceiverMock = vi.fn();

let voiceConnected = false;

vi.mock("../security/isElevated.js", () => ({
  isElevated: vi.fn(() => true),
}));

vi.mock("../meepo/state.js", () => ({
  getActiveMeepo: vi.fn(() => null),
  wakeMeepo: vi.fn(() => undefined),
  sleepMeepo: vi.fn(() => true),
}));

vi.mock("../sessions/transcriptExport.js", () => ({
  ensureBronzeTranscriptExportCached: ensureBronzeTranscriptExportCachedMock,
}));

vi.mock("../sessions/recapService.js", () => ({
  generateSessionRecapContract: generateSessionRecapMock,
}));

vi.mock("../voice/connection.js", () => ({
  joinVoice: joinVoiceMock,
  leaveVoice: leaveVoiceMock,
}));

vi.mock("../voice/receiver.js", () => ({
  startReceiver: vi.fn(),
  stopReceiver: stopReceiverMock,
}));

vi.mock("../voice/state.js", () => ({
  getVoiceState: vi.fn(() => (voiceConnected ? ({ channelId: "voice-1" } as any) : null)),
  setVoiceState: vi.fn(),
  setVoiceHushEnabled: vi.fn(),
  isVoiceHushEnabled: vi.fn(() => true),
}));

function configureHermeticEnv(tempDir: string): void {
  vi.stubEnv("DATA_ROOT", tempDir);
  vi.stubEnv("DATA_CAMPAIGNS_DIR", "campaigns");
  vi.stubEnv("DATA_DB_FILENAME", "db.sqlite");
  vi.stubEnv("MIGRATIONS_SILENT", "1");
  vi.stubEnv("DEFAULT_CAMPAIGN_SLUG", "default");
}

function buildInteraction(args: {
  subcommand: string;
  subcommandGroup?: string | null;
  guildId?: string;
  channelId?: string;
  voiceChannelId?: string | null;
  userId?: string;
  strings?: Record<string, string | null>;
}) {
  const voiceChannelId = args.voiceChannelId === undefined ? "voice-1" : args.voiceChannelId;
  return {
    type: InteractionType.ApplicationCommand,
    guildId: args.guildId ?? "guild-1",
    channelId: args.channelId ?? "channel-1",
    guild: {
      name: "Guild One",
      members: {
        fetch: vi.fn(async () => ({ voice: { channelId: voiceChannelId } })),
      },
      voiceAdapterCreator: {},
    },
    member: { voice: { channelId: voiceChannelId } },
    memberPermissions: { has: vi.fn(() => true) },
    user: { id: args.userId ?? "dm-user", username: "DM" },
    deferred: false,
    replied: false,
    reply: vi.fn(async () => undefined),
    followUp: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
    options: {
      getSubcommandGroup: () => args.subcommandGroup ?? null,
      getSubcommand: () => args.subcommand,
      getString: (name: string) => args.strings?.[name] ?? null,
    },
  } as any;
}

afterEach(() => {
  voiceConnected = false;
  joinVoiceMock.mockReset();
  leaveVoiceMock.mockReset();
  stopReceiverMock.mockReset();
  ensureBronzeTranscriptExportCachedMock.mockReset();
  generateSessionRecapMock.mockReset();
  vi.unstubAllEnvs();
  vi.resetModules();

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore transient Windows file-lock cleanup issues.
      }
    }
  }
});

describe("/meepo lifecycle run 1", () => {
  test("awakens once and subsequent awaken is harmless guidance", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-awaken-run1-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const { meepo } = await import("../commands/meepo.js");
    const { getDbForCampaign } = await import("../db.js");
    const { getGuildAwakened } = await import("../campaign/guildConfig.js");
    const { getActiveSession } = await import("../sessions/sessions.js");

    const db = getDbForCampaign("default");

    const first = buildInteraction({ subcommand: "awaken" });
    await meepo.execute(first, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    expect(first.reply).toHaveBeenCalledTimes(1);
    const firstContent = String(first.reply.mock.calls[0]?.[0]?.content ?? "");
    expect(firstContent).toContain("The Archive is now attentive.");
    expect(firstContent).toContain("Guild setup is complete for Closed Alpha.");
    expect(getGuildAwakened("guild-1")).toBe(true);
    const { getGuildMetaCampaignSlug } = await import("../campaign/guildConfig.js");
    const { getGuildDmUserId, getGuildHomeTextChannelId, getGuildHomeVoiceChannelId } = await import("../campaign/guildConfig.js");
    expect(getGuildMetaCampaignSlug("guild-1")).toBe("guild_one");
    expect(getGuildDmUserId("guild-1")).toBe("dm-user");
    expect(getGuildHomeTextChannelId("guild-1")).toBe("channel-1");
    expect(getGuildHomeVoiceChannelId("guild-1")).toBeNull();
    expect(getActiveSession("guild-1")).toBeNull();

    const second = buildInteraction({ subcommand: "awaken" });
    await meepo.execute(second, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    expect(second.reply).toHaveBeenCalledTimes(1);
    const secondContent = String(second.reply.mock.calls[0]?.[0]?.content ?? "");
    expect(secondContent).toContain("already awakened");
    expect(getGuildDmUserId("guild-1")).toBe("dm-user");
    expect(getGuildHomeTextChannelId("guild-1")).toBe("channel-1");
    expect(getGuildHomeVoiceChannelId("guild-1")).toBeNull();
    expect(getActiveSession("guild-1")).toBeNull();

    db.close();
  });

  test("showtime start works without running awaken first", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-awaken-run1-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const { meepo } = await import("../commands/meepo.js");
    const { getDbForCampaign } = await import("../db.js");

    const db = getDbForCampaign("default");
    const interaction = buildInteraction({ subcommand: "start", subcommandGroup: "showtime" });

    await meepo.execute(interaction, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    const content = String(interaction.reply.mock.calls[0]?.[0]?.content ?? "");
    expect(content).toContain("Showtime begins");
    expect(content).toContain("listen-only");

    const { getActiveSession } = await import("../sessions/sessions.js");
    expect(getActiveSession("guild-1")).toBeTruthy();
    db.close();
  });

  test("showtime start rejects second active session without mutation", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-awaken-run1-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const { meepo } = await import("../commands/meepo.js");
    const { getDbForCampaign } = await import("../db.js");
    const { getActiveSession } = await import("../sessions/sessions.js");

    const db = getDbForCampaign("default");

    const awaken = buildInteraction({ subcommand: "awaken" });
    await meepo.execute(awaken, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    const firstStart = buildInteraction({
      subcommand: "start",
      subcommandGroup: "showtime",
      strings: { campaign_name: "Echoes of Avernus" },
    });
    await meepo.execute(firstStart, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    const activeAfterFirst = getActiveSession("guild-1");
    expect(activeAfterFirst).toBeTruthy();

    const secondStart = buildInteraction({ subcommand: "start", subcommandGroup: "showtime" });
    await meepo.execute(secondStart, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    const activeAfterSecond = getActiveSession("guild-1");
    expect(activeAfterSecond?.session_id).toBe(activeAfterFirst?.session_id);
    const rejectContent = String(secondStart.reply.mock.calls[0]?.[0]?.content ?? "");
    expect(rejectContent).toContain("already active");

    db.close();
  });

  test("showtime end succeeds even when async artifact kickoff fails", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-awaken-run1-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    generateSessionRecapMock.mockRejectedValue(new Error("artifact failure"));

    const { meepo } = await import("../commands/meepo.js");
    const { getDbForCampaign } = await import("../db.js");
    const { getActiveSession, getMostRecentSession } = await import("../sessions/sessions.js");

    const db = getDbForCampaign("default");

    await meepo.execute(buildInteraction({ subcommand: "awaken" }), {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    await meepo.execute(buildInteraction({
      subcommand: "start",
      subcommandGroup: "showtime",
      strings: { campaign_name: "Echoes of Avernus" },
    }), {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    const endInteraction = buildInteraction({ subcommand: "end", subcommandGroup: "showtime" });
    await meepo.execute(endInteraction, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    expect(endInteraction.reply).toHaveBeenCalledTimes(1);
    const endContent = String(endInteraction.reply.mock.calls[0]?.[0]?.content ?? "");
    expect(endContent).toContain("Session complete");
    expect(getActiveSession("guild-1")).toBeNull();

    // Async kickoff should not break session completion response.
    await Promise.resolve();
    await Promise.resolve();

    expect(ensureBronzeTranscriptExportCachedMock).toHaveBeenCalled();
    expect(generateSessionRecapMock).toHaveBeenCalled();

    const mostRecent = getMostRecentSession("guild-1");
    expect(mostRecent?.status).toBe("completed");

    db.close();
  });

  test("showtime creation with duplicate names applies deterministic slug suffixes", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-awaken-run1-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const { meepo } = await import("../commands/meepo.js");
    const { getDbForCampaign } = await import("../db.js");
    const { listShowtimeCampaigns } = await import("../campaign/showtimeCampaigns.js");

    const db = getDbForCampaign("default");

    await meepo.execute(buildInteraction({ subcommand: "awaken" }), {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    await meepo.execute(buildInteraction({
      subcommand: "start",
      subcommandGroup: "showtime",
      strings: { campaign_name: "Echoes of Avernus" },
    }), {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    await meepo.execute(buildInteraction({ subcommand: "end", subcommandGroup: "showtime" }), {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    await meepo.execute(buildInteraction({
      subcommand: "start",
      subcommandGroup: "showtime",
      strings: { campaign_name: "Echoes of Avernus" },
    }), {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    const records = listShowtimeCampaigns("guild-1");
    expect(records.map((record) => record.campaign_slug)).toEqual(["echoes_of_avernus", "echoes_of_avernus_2"]);

    db.close();
  });

  test("showtime start with zero args auto-creates and then reuses Campaign Alpha", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-awaken-run1-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const { meepo } = await import("../commands/meepo.js");
    const { getDbForCampaign } = await import("../db.js");
    const { listShowtimeCampaigns } = await import("../campaign/showtimeCampaigns.js");

    const db = getDbForCampaign("default");

    await meepo.execute(buildInteraction({ subcommand: "awaken" }), {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    const firstStart = buildInteraction({ subcommand: "start", subcommandGroup: "showtime" });
    await meepo.execute(firstStart, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    expect(firstStart.reply).toHaveBeenCalledTimes(1);
    const firstContent = String(firstStart.reply.mock.calls[0]?.[0]?.content ?? "");
    expect(firstContent).toContain("Created campaign **Campaign Alpha**");

    const campaignsAfterFirst = listShowtimeCampaigns("guild-1");
    expect(campaignsAfterFirst).toHaveLength(1);
    expect(campaignsAfterFirst[0]?.campaign_name).toBe("Campaign Alpha");

    await meepo.execute(buildInteraction({ subcommand: "end", subcommandGroup: "showtime" }), {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    const secondStart = buildInteraction({ subcommand: "start", subcommandGroup: "showtime" });
    await meepo.execute(secondStart, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
    });

    expect(secondStart.reply).toHaveBeenCalledTimes(1);
    const secondContent = String(secondStart.reply.mock.calls[0]?.[0]?.content ?? "");
    expect(secondContent).toContain("Using campaign **Campaign Alpha**");

    const campaignsAfterSecond = listShowtimeCampaigns("guild-1");
    expect(campaignsAfterSecond).toHaveLength(1);

    db.close();
  });
});
