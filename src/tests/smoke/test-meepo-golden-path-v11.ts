import { afterEach, describe, expect, test, vi } from "vitest";

let activeSession: any | null = null;
let recapArtifact: any | null = null;
let baseExists = false;
let awakened = false;
let currentCampaignSlug = "default";
let metaCampaignSlug: string | null = null;
let dmUserId: string | null = "user-1";
const showtimeCampaigns: Array<{ campaign_slug: string; campaign_name: string }> = [];

vi.mock("../../campaign/guildConfig.js", () => ({
  ensureGuildConfig: vi.fn(() => ({ campaign_slug: currentCampaignSlug })),
  getGuildAwakened: vi.fn(() => awakened),
  getGuildMetaCampaignSlug: vi.fn(() => metaCampaignSlug),
  setGuildAwakened: vi.fn((_guildId: string, value: boolean) => {
    awakened = value;
  }),
  setGuildCampaignSlug: vi.fn((_guildId: string, value: string) => {
    currentCampaignSlug = value;
  }),
  setGuildMetaCampaignSlug: vi.fn((_guildId: string, value: string | null) => {
    metaCampaignSlug = value;
  }),
  getGuildCanonPersonaId: vi.fn(() => null),
  getGuildCanonPersonaMode: vi.fn(() => "meta"),
  getGuildDmUserId: vi.fn(() => dmUserId),
  getGuildConfig: vi.fn(() => ({ campaign_slug: "default", setup_version: 1, default_recap_style: "balanced" })),
  getGuildDefaultRecapStyle: vi.fn(() => "balanced"),
  getGuildHomeTextChannelId: vi.fn(() => "text-1"),
  setGuildHomeTextChannelId: vi.fn(),
  getGuildHomeVoiceChannelId: vi.fn(() => null),
  getGuildSetupVersion: vi.fn(() => 1),
  resolveGuildHomeVoiceChannelId: vi.fn(() => null),
  setGuildHomeVoiceChannelId: vi.fn(),
  setGuildCanonPersonaId: vi.fn(),
  setGuildCanonPersonaMode: vi.fn(),
  setGuildDefaultRecapStyle: vi.fn(),
  setGuildDmUserId: vi.fn((_guildId: string, value: string | null) => {
    dmUserId = value;
  }),
}));

vi.mock("../../campaign/ensureGuildSetup.js", () => ({
  ensureGuildSetup: vi.fn(async () => ({
    applied: ["Bound home text to <#text-1>"],
    warnings: [],
    errors: [],
    setupVersionChanged: false,
    canAttemptVoice: false,
  })),
}));

vi.mock("../../campaign/showtimeCampaigns.js", () => ({
  listShowtimeCampaigns: vi.fn(() => showtimeCampaigns.map((record) => ({
    guild_id: "guild-1",
    campaign_slug: record.campaign_slug,
    campaign_name: record.campaign_name,
    created_at_ms: Date.now(),
    created_by_user_id: "user-1",
  }))),
  getShowtimeCampaignBySlug: vi.fn((_guildId: string, slug: string) => {
    const found = showtimeCampaigns.find((record) => record.campaign_slug === slug);
    if (!found) return null;
    return {
      guild_id: "guild-1",
      campaign_slug: found.campaign_slug,
      campaign_name: found.campaign_name,
      created_at_ms: Date.now(),
      created_by_user_id: "user-1",
    };
  }),
  createShowtimeCampaign: vi.fn((_args: { guildId: string; campaignName: string; createdByUserId?: string }) => {
    const slug = `campaign_${showtimeCampaigns.length + 1}`;
    const record = { campaign_slug: slug, campaign_name: "Echoes of Avernus" };
    showtimeCampaigns.push(record);
    return {
      guild_id: "guild-1",
      campaign_slug: record.campaign_slug,
      campaign_name: record.campaign_name,
      created_at_ms: Date.now(),
      created_by_user_id: "user-1",
    };
  }),
}));

vi.mock("../../config/env.js", () => ({
  cfg: {
    tts: { enabled: false },
    overlay: { homeVoiceChannelId: null },
    openai: { apiKey: "test" },
    data: { root: ".", campaignsDir: "campaigns" },
    db: { filename: "db.sqlite", path: "db.sqlite" },
    voice: { debug: false },
    logging: {
      level: "error",
      scopes: [],
      format: "pretty",
      debugLatch: false,
    },
  },
}));

vi.mock("../../meepo/state.js", () => ({
  getActiveMeepo: vi.fn(() => ({ id: "active", reply_mode: "text" })),
  wakeMeepo: vi.fn(),
  sleepMeepo: vi.fn(() => 1),
}));

vi.mock("../../meepo/personaState.js", () => ({
  getEffectivePersonaId: vi.fn(() => "meta_meepo"),
}));

vi.mock("../../personas/index.js", () => ({
  getPersona: vi.fn(() => ({ displayName: "Meta Meepo" })),
}));

vi.mock("../../security/isElevated.js", () => ({
  isElevated: vi.fn(() => true),
}));

vi.mock("../../ledger/system.js", () => ({
  logSystemEvent: vi.fn(),
}));

vi.mock("../../sessions/sessionRuntime.js", () => ({
  resolveEffectiveMode: vi.fn(() => (activeSession ? "canon" : "ambient")),
  setGuildMode: vi.fn(() => undefined),
}));

vi.mock("../../sessions/sessions.js", () => ({
  endSession: vi.fn(() => {
    activeSession = null;
    return 1;
  }),
  getActiveSession: vi.fn(() => activeSession),
  getMostRecentSession: vi.fn(() => activeSession),
  getSessionById: vi.fn((_guildId: string, sessionId: string) => (activeSession?.session_id === sessionId ? activeSession : null)),
  listSessions: vi.fn(() => (activeSession ? [activeSession] : [])),
  startSession: vi.fn((_guildId: string, _userId: string, _userName: string, opts: any) => {
    activeSession = {
      session_id: "session-golden-1",
      label: opts?.label ?? "C2E21",
      kind: "canon",
      mode_at_start: "canon",
      started_at_ms: Date.now(),
      ended_at_ms: null,
    };
    return activeSession;
  }),
  getSessionArtifact: vi.fn((_guildId: string, _sessionId: string, artifactType: string) => {
    if (artifactType === "recap_final") return recapArtifact;
    if (artifactType === "transcript_export" && activeSession) {
      return {
        id: "artifact-transcript-1",
        session_id: activeSession.session_id,
        artifact_type: "transcript_export",
        created_at_ms: Date.now(),
        source_hash: "tx-hash-123",
        strategy: null,
        strategy_version: null,
        meta_json: "{}",
        content_text: "",
        file_path: "mock-transcript.log",
        size_bytes: 1,
      };
    }
    return null;
  }),
  getSessionArtifactMap: vi.fn(() => {
    const map = new Map<string, any>();
    if (activeSession && recapArtifact) map.set(activeSession.session_id, recapArtifact);
    return map;
  }),
}));

vi.mock("../../sessions/recapService.js", () => ({
  generateSessionRecapContract: vi.fn(async ({ sessionId }: any) => {
    const strategy = "balanced";
    baseExists = true;
    recapArtifact = {
      id: "artifact-1",
      session_id: sessionId,
      artifact_type: "recap_final",
      created_at_ms: Date.now(),
      source_hash: "hash-1234567890",
      strategy,
      strategy_version: "megameecap-final-v1",
      meta_json: JSON.stringify({
        final_style: strategy,
        final_version: "megameecap-final-v1",
        base_version: "megameecap-base-v1",
      }),
      content_text: "# Recap\n\nGolden path recap",
      file_path: null,
      size_bytes: 20,
    };

    return {
      concise: "",
      balanced: recapArtifact.content_text,
      detailed: "",
      engine: "megameecap",
      source_hash: recapArtifact.source_hash,
      strategy_version: "megameecap-final-v1",
      meta_json: JSON.stringify({
        model_version: "session-recaps-v2",
        base_version: "megameecap-base-v1",
        styles: {
          concise: { cacheHit: false, sourceHash: recapArtifact.source_hash },
          balanced: { cacheHit: false, sourceHash: recapArtifact.source_hash },
          detailed: { cacheHit: false, sourceHash: recapArtifact.source_hash },
        },
      }),
      generated_at_ms: recapArtifact.created_at_ms,
      created_at_ms: recapArtifact.created_at_ms,
      updated_at_ms: recapArtifact.created_at_ms,
      source: "canonical",
    };
  }),
}));

vi.mock("../../sessions/megameecapArtifactLocator.js", () => ({
  buildSessionArtifactStem: vi.fn(() => "session-C2E21"),
  getBaseStatus: vi.fn(() => ({ exists: baseExists, sourceHash: "hash", baseVersion: "megameecap-base-v1" })),
  getFinalStatus: vi.fn(() => ({ exists: true, paths: null })),
  getAllFinalStatuses: vi.fn(() => [{ exists: true }]),
}));

vi.mock("../../sessions/transcriptExport.js", () => ({
  ensureBronzeTranscriptExportCached: vi.fn(() => ({
    path: "mock-transcript.log",
    bytes: 0,
    hash: "mock",
    cacheHit: true,
  })),
}));

vi.mock("../../voice/connection.js", () => ({
  joinVoice: vi.fn(),
  leaveVoice: vi.fn(),
}));

vi.mock("../../voice/receiver.js", () => ({
  startReceiver: vi.fn(),
  stopReceiver: vi.fn(),
}));

vi.mock("../../voice/state.js", () => ({
  getVoiceState: vi.fn(() => ({ channelId: "voice-1" })),
  isVoiceHushEnabled: vi.fn(() => true),
  setVoiceHushEnabled: vi.fn(),
  setVoiceState: vi.fn(),
}));

vi.mock("../../voice/stt/provider.js", () => ({ getSttProviderInfo: vi.fn(() => ({ name: "noop" })) }));
vi.mock("../../voice/tts/provider.js", () => ({ getTtsProviderInfo: vi.fn(() => ({ name: "noop" })) }));
vi.mock("../../voice/voicePlaybackController.js", () => ({ voicePlaybackController: { abort: vi.fn() } }));

vi.mock("../../ledger/meepoContextWorker.js", () => ({
  getMeepoContextWorkerStatus: vi.fn(() => ({
    enabled: true,
    running: true,
    queue: {
      queuedCount: 0,
      leasedCount: 0,
      failedCount: 0,
      oldestQueuedAgeMs: null,
      lastCompletedAtMs: null,
    },
  })),
}));

afterEach(() => {
  activeSession = null;
  recapArtifact = null;
  baseExists = false;
  awakened = false;
  currentCampaignSlug = "default";
  metaCampaignSlug = null;
  dmUserId = "user-1";
  showtimeCampaigns.length = 0;
  vi.clearAllMocks();
});

describe("v1.1 golden path smoke (mocked)", () => {
  test("wake -> showtime start -> recap -> view surfaces stable metadata", async () => {
    const { meepo } = await import("../../commands/meepo.js");
    const mockDb = {
      prepare: vi.fn(() => ({
        run: vi.fn(),
        get: vi.fn(() => ({ ts: null })),
        all: vi.fn(() => []),
      })),
    };

    const wakeReply = vi.fn(async (_payload: any) => undefined);
    await meepo.execute(
      {
        guildId: "guild-1",
        channelId: "text-1",
        guild: {
          name: "Test Guild",
          voiceAdapterCreator: {},
          members: { fetch: vi.fn(async () => ({ voice: { channelId: null } })) },
        },
        user: { id: "user-1", username: "Tester" },
        member: {},
        options: {
          getSubcommandGroup: vi.fn(() => null),
          getSubcommand: vi.fn(() => "wake"),
          getString: vi.fn(() => "C2E21"),
        },
        reply: wakeReply,
      } as any,
      { guildId: "guild-1", campaignSlug: "default", dbPath: "test.sqlite", db: mockDb }
    );

    const showtimeReply = vi.fn(async (_payload: any) => undefined);
    await meepo.execute(
      {
        guildId: "guild-1",
        channelId: "text-1",
        guild: { name: "Test Guild", voiceAdapterCreator: {} },
        user: { id: "user-1", username: "Tester" },
        member: {},
        options: {
          getSubcommandGroup: vi.fn(() => "showtime"),
          getSubcommand: vi.fn(() => "start"),
          getString: vi.fn((name: string) => (name === "campaign_name" ? "Echoes of Avernus" : null)),
        },
        reply: showtimeReply,
      } as any,
      { guildId: "guild-1", campaignSlug: "default", dbPath: "test.sqlite", db: mockDb }
    );

    const recapEditReply = vi.fn(async (_payload: any) => undefined);
    const recapReply = vi.fn(async (_payload: any) => undefined);
    await meepo.execute(
      {
        guildId: "guild-1",
        channelId: "text-1",
        guild: { name: "Test Guild", voiceAdapterCreator: {} },
        user: { id: "user-1", username: "Tester" },
        member: {},
        options: {
          getSubcommandGroup: vi.fn(() => "sessions"),
          getSubcommand: vi.fn(() => "recap"),
          getString: vi.fn((name: string) => (name === "style" ? "balanced" : "session-golden-1")),
          getBoolean: vi.fn(() => false),
        },
        deferReply: vi.fn(async () => undefined),
        editReply: recapEditReply,
        reply: recapReply,
      } as any,
      { guildId: "guild-1", campaignSlug: "default", dbPath: "test.sqlite", db: mockDb }
    );

    const viewReply = vi.fn(async (_payload: any) => undefined);
    await meepo.execute(
      {
        guildId: "guild-1",
        channelId: "text-1",
        guild: { name: "Test Guild", voiceAdapterCreator: {} },
        user: { id: "user-1", username: "Tester" },
        member: {},
        options: {
          getSubcommandGroup: vi.fn(() => "sessions"),
          getSubcommand: vi.fn(() => "view"),
          getString: vi.fn(() => "session-golden-1"),
          getBoolean: vi.fn(() => false),
        },
        reply: viewReply,
      } as any,
      { guildId: "guild-1", campaignSlug: "default", dbPath: "test.sqlite", db: mockDb }
    );

    expect(wakeReply).toHaveBeenCalledTimes(1);
    expect(showtimeReply).toHaveBeenCalledTimes(1);
    expect(recapEditReply.mock.calls.length + recapReply.mock.calls.length).toBe(1);
    expect(viewReply).toHaveBeenCalledTimes(1);

    const viewPayload = viewReply.mock.calls.at(0)?.[0];
    expect(viewPayload.content).toContain("Recap");
    expect(viewPayload.content).toContain("Final:");
    expect(viewPayload.content).toContain("balanced");
    expect(viewPayload.content).toContain("Base:");
  });
});
