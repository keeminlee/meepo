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
const voiceSpeakMock = vi.fn();
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

vi.mock("../voice/voicePlaybackController.js", () => ({
  voicePlaybackController: {
    speak: voiceSpeakMock,
    abort: vi.fn(),
    onUserSpeechStart: vi.fn(() => false),
    getIsSpeaking: vi.fn(() => false),
    setIsSpeaking: vi.fn(),
    resetGuild: vi.fn(),
    registerAbortHandler: vi.fn(),
    unregisterAbortHandler: vi.fn(),
  },
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
  leaveVoiceMock.mockReset();
  joinVoiceMock.mockReset();
  voiceSpeakMock.mockReset();
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

describe("showtime lifecycle hardening", () => {
  test("/meepo showtime start joins invoker voice channel in listen-only mode", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-showtime-start-nonvoice-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const { meepo } = await import("../commands/meepo.js");
    const { getDbForCampaign } = await import("../db.js");
    const db = getDbForCampaign("default");

    const execCtx = {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
      trace_id: "trace-showtime-start-nonvoice",
      interaction_id: "interaction-showtime-start-nonvoice",
    } as any;

    await meepo.execute(buildInteraction({ subcommand: "awaken" }), execCtx);
    const startInteraction = buildInteraction({ subcommand: "start", subcommandGroup: "showtime", voiceChannelId: "voice-1" });
    await meepo.execute(startInteraction, execCtx);

    expect(joinVoiceMock).toHaveBeenCalledTimes(1);
    expect(joinVoiceMock).toHaveBeenCalledWith(expect.objectContaining({ guildId: "guild-1", channelId: "voice-1" }));
    expect(voiceSpeakMock).not.toHaveBeenCalled();
    const content = String(startInteraction.reply.mock.calls[0]?.[0]?.content ?? "");
    expect(content).toContain("listen-only");

    db.close();
  });

  test("/meepo showtime start requires invoker to be in voice", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-showtime-start-requires-voice-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const { meepo } = await import("../commands/meepo.js");
    const { getDbForCampaign } = await import("../db.js");
    const { getActiveSession } = await import("../sessions/sessions.js");
    const db = getDbForCampaign("default");

    const execCtx = {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
      trace_id: "trace-showtime-start-needs-voice",
      interaction_id: "interaction-showtime-start-needs-voice",
    } as any;

    await meepo.execute(buildInteraction({ subcommand: "awaken" }), execCtx);
    const startInteraction = buildInteraction({ subcommand: "start", subcommandGroup: "showtime", voiceChannelId: null });
    await meepo.execute(startInteraction, execCtx);

    expect(joinVoiceMock).not.toHaveBeenCalled();
    expect(getActiveSession("guild-1")).toBeNull();
    const content = String(startInteraction.reply.mock.calls[0]?.[0]?.content ?? "");
    expect(content).toContain("Join a voice channel first");

    db.close();
  });

  test("/meepo showtime end finalizes session and leaves voice when connected", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-showtime-end-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    const { meepo } = await import("../commands/meepo.js");
    const { getDbForCampaign } = await import("../db.js");
    const { getActiveSession, getMostRecentSession } = await import("../sessions/sessions.js");

    const db = getDbForCampaign("default");

    const execCtx = {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
      trace_id: "trace-showtime",
      interaction_id: "interaction-showtime",
    } as any;

    await meepo.execute(buildInteraction({ subcommand: "awaken" }), execCtx);

    await meepo.execute(buildInteraction({
      subcommand: "start",
      subcommandGroup: "showtime",
      strings: { campaign_name: "Echoes of Avernus" },
    }), execCtx);

    expect(getActiveSession("guild-1")).toBeTruthy();

    voiceConnected = true;

    const endInteraction = buildInteraction({ subcommand: "end", subcommandGroup: "showtime" });
    await meepo.execute(endInteraction, execCtx);

    expect(stopReceiverMock).toHaveBeenCalledWith("guild-1");
    expect(leaveVoiceMock).toHaveBeenCalledWith("guild-1");

    expect(getActiveSession("guild-1")).toBeNull();
    const latest = getMostRecentSession("guild-1");
    expect(latest?.status).toBe("completed");

    const content = String(endInteraction.reply.mock.calls[0]?.[0]?.content ?? "");
    expect(content).toContain("Session complete");
    expect(content).toContain("left voice");

    db.close();
  });

  test("emits showtime lifecycle and artifact kickoff payloads with canonical fields", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-showtime-events-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    generateSessionRecapMock.mockResolvedValue({
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
    });

    const { meepo } = await import("../commands/meepo.js");
    const { getDbForCampaign } = await import("../db.js");
    const db = getDbForCampaign("default");

    const execCtx = {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
      trace_id: "trace-event-contract",
      interaction_id: "interaction-event-contract",
    } as any;

    await meepo.execute(buildInteraction({ subcommand: "awaken" }), execCtx);

    await meepo.execute(buildInteraction({
      subcommand: "start",
      subcommandGroup: "showtime",
      strings: { campaign_name: "Campaign Alpha" },
    }), execCtx);

    voiceConnected = true;
    await meepo.execute(buildInteraction({ subcommand: "end", subcommandGroup: "showtime" }), execCtx);

    // Kickoff is async fire-and-forget; wait one tick for start/success rows.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const eventDb = getDbForCampaign("campaign_alpha");
    const rows = eventDb
      .prepare(
        `SELECT tags, content
         FROM ledger_entries
         WHERE guild_id = ? AND source = 'system'
         ORDER BY timestamp_ms ASC, id ASC`
      )
      .all("guild-1") as Array<{ tags: string; content: string }>;

    const payloadFor = (eventType: string) => {
      const row = rows.find((item) => item.tags === `system,${eventType}`);
      expect(row).toBeTruthy();
      return JSON.parse(String(row?.content ?? "{}")) as Record<string, unknown>;
    };

    const assertCanonical = (payload: Record<string, unknown>, eventType: string) => {
      expect(payload.event_type).toBe(eventType);
      expect(payload.guild_id).toBe("guild-1");
      expect(payload.campaign_slug).toBe("campaign_alpha");
      expect(typeof payload.session_id).toBe("string");
      expect(payload.trace_id).toBe("trace-event-contract");
      expect(typeof payload.timestamp_ms).toBe("number");
    };

    const voiceJoin = payloadFor("VOICE_JOIN");
    assertCanonical(voiceJoin, "VOICE_JOIN");
    expect(voiceJoin.listen_only).toBe(true);

    const showtimeStart = payloadFor("SHOWTIME_START");
    assertCanonical(showtimeStart, "SHOWTIME_START");

    const transcriptBegin = payloadFor("TRANSCRIPT_BEGIN");
    assertCanonical(transcriptBegin, "TRANSCRIPT_BEGIN");
    expect(transcriptBegin.outcome).toBe("start");

    const transcriptWrite = payloadFor("TRANSCRIPT_WRITE");
    assertCanonical(transcriptWrite, "TRANSCRIPT_WRITE");
    expect(typeof transcriptWrite.cache_hit).toBe("boolean");

    const transcriptEnd = payloadFor("TRANSCRIPT_END");
    assertCanonical(transcriptEnd, "TRANSCRIPT_END");
    expect(transcriptEnd.outcome).toBe("success");

    const recapGenerateRows = rows
      .filter((item) => item.tags === "system,RECAP_GENERATE")
      .map((item) => JSON.parse(item.content) as Record<string, unknown>);
    expect(recapGenerateRows.length).toBeGreaterThanOrEqual(2);
    expect(recapGenerateRows.some((payload) => payload.outcome === "start")).toBe(true);
    expect(recapGenerateRows.some((payload) => payload.outcome === "success")).toBe(true);
    for (const payload of recapGenerateRows) {
      assertCanonical(payload, "RECAP_GENERATE");
      expect(typeof payload.strategy).toBe("string");
    }

    const recapStatusRows = rows
      .filter((item) => item.tags === "system,SESSION_RECAP_STATUS")
      .map((item) => JSON.parse(item.content) as Record<string, unknown>);
    expect(recapStatusRows.some((payload) => payload.readiness === "pending")).toBe(true);
    expect(recapStatusRows.some((payload) => payload.readiness === "ready")).toBe(true);

    const recapGenerated = payloadFor("SESSION_RECAP_GENERATED");
    assertCanonical(recapGenerated, "SESSION_RECAP_GENERATED");
    expect(typeof recapGenerated.strategy).toBe("string");
    expect(typeof recapGenerated.cache_hit).toBe("boolean");

    const showtimeEnd = payloadFor("SHOWTIME_END");
    assertCanonical(showtimeEnd, "SHOWTIME_END");

    const voiceLeave = payloadFor("VOICE_LEAVE");
    assertCanonical(voiceLeave, "VOICE_LEAVE");

    const kickoffRows = rows
      .filter((item) => item.tags === "system,SHOWTIME_ARTIFACT_KICKOFF")
      .map((item) => JSON.parse(item.content) as Record<string, unknown>);
    expect(kickoffRows.length).toBeGreaterThanOrEqual(2);
    expect(kickoffRows.some((payload) => payload.stage === "start")).toBe(true);
    expect(kickoffRows.some((payload) => payload.stage === "success")).toBe(true);
    for (const payload of kickoffRows) {
      assertCanonical(payload, "SHOWTIME_ARTIFACT_KICKOFF");
    }

    eventDb.close();
    db.close();
  });

  test("emits coherent failure-path events when recap generation fails", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-showtime-events-failure-"));
    tempDirs.push(tempDir);
    configureHermeticEnv(tempDir);

    generateSessionRecapMock.mockRejectedValue(new Error("recap failure"));

    const { meepo } = await import("../commands/meepo.js");
    const { getDbForCampaign } = await import("../db.js");
    const db = getDbForCampaign("default");

    const execCtx = {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db,
      trace_id: "trace-event-failure",
      interaction_id: "interaction-event-failure",
    } as any;

    await meepo.execute(buildInteraction({ subcommand: "start", subcommandGroup: "showtime" }), execCtx);
    voiceConnected = true;
    await meepo.execute(buildInteraction({ subcommand: "end", subcommandGroup: "showtime" }), execCtx);
    await new Promise((resolve) => setTimeout(resolve, 900));

    const eventDb = getDbForCampaign("campaign_alpha");
    const rows = eventDb
      .prepare(
        `SELECT tags, content
         FROM ledger_entries
         WHERE guild_id = ? AND source = 'system'
         ORDER BY timestamp_ms ASC, id ASC`
      )
      .all("guild-1") as Array<{ tags: string; content: string }>;

    const transcriptEnd = JSON.parse(
      String(rows.find((item) => item.tags === "system,TRANSCRIPT_END")?.content ?? "{}")
    ) as Record<string, unknown>;
    expect(transcriptEnd.outcome).toBe("success");

    const recapGenerateRows = rows
      .filter((item) => item.tags === "system,RECAP_GENERATE")
      .map((item) => JSON.parse(item.content) as Record<string, unknown>);
    expect(recapGenerateRows.some((payload) => payload.outcome === "start")).toBe(true);
    const recapFailures = recapGenerateRows.filter((payload) => payload.outcome === "failure");
    expect(recapFailures.length).toBeGreaterThanOrEqual(1);
    const recapFailure = recapFailures.at(-1);
    expect(recapFailure).toBeTruthy();
    expect(String(recapFailure?.error ?? "")).toContain("recap failure");

    const recapStatusRows = rows
      .filter((item) => item.tags === "system,SESSION_RECAP_STATUS")
      .map((item) => JSON.parse(item.content) as Record<string, unknown>);
    expect(recapStatusRows.some((payload) => payload.readiness === "pending")).toBe(true);
    expect(recapStatusRows.some((payload) => payload.readiness === "failed")).toBe(true);

    const kickoffError = JSON.parse(
      String(
        rows
          .filter((item) => item.tags === "system,SHOWTIME_ARTIFACT_KICKOFF")
          .find((item) => JSON.parse(item.content).stage === "error")?.content ?? "{}"
      )
    ) as Record<string, unknown>;
    expect(kickoffError.outcome).toBe("failure");
    expect(String(kickoffError.error ?? "")).toContain("recap failure");

    eventDb.close();
    db.close();
  });
});
