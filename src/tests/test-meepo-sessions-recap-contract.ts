import { afterEach, describe, expect, test, vi } from "vitest";

const baseSession = {
  session_id: "session-1",
  label: "Arc A",
  kind: "canon",
  mode_at_start: "canon",
  started_at_ms: Date.now() - 60_000,
  ended_at_ms: Date.now(),
};

let sessionById: typeof baseSession | null = { ...baseSession };
let recapArtifact: any | null = null;
let transcriptArtifact: any | null = {
  id: "transcript-1",
  session_id: "session-1",
  artifact_type: "transcript_export",
  created_at_ms: Date.now(),
  engine: "bronze_transcript_export_v1",
  source_hash: "tx-hash-1",
  strategy: "default",
  strategy_version: "v1",
  meta_json: "{}",
  content_text: "DM: Welcome",
  file_path: null,
  size_bytes: 12,
};
const ensureBronzeTranscriptExportCachedMock = vi.fn(() => ({
  path: "transcript.log",
  bytes: 12,
  hash: "tx-hash-1",
  cacheHit: true,
}));

function buildCanonicalRecapContract(overrides?: Partial<any>) {
  return {
    concise: "# Recap\n\nGenerated concise recap",
    balanced: "# Recap\n\nGenerated recap",
    detailed: "# Recap\n\nGenerated detailed recap",
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
    source: "canonical" as const,
    ...overrides,
  };
}

vi.mock("../campaign/guildConfig.js", () => ({
  getGuildCanonPersonaId: vi.fn(() => null),
  getGuildCanonPersonaMode: vi.fn(() => "meta"),
  getGuildDmUserId: vi.fn(() => null),
  getGuildConfig: vi.fn(() => ({ campaign_slug: "default" })),
  getGuildDefaultRecapStyle: vi.fn(() => "balanced"),
  getGuildHomeTextChannelId: vi.fn(() => "text-1"),
  setGuildHomeTextChannelId: vi.fn(),
  getGuildHomeVoiceChannelId: vi.fn(() => null),
  getGuildSetupVersion: vi.fn(() => 1),
  setGuildHomeVoiceChannelId: vi.fn(),
  resolveGuildHomeVoiceChannelId: vi.fn(() => null),
  setGuildCanonPersonaId: vi.fn(),
  setGuildCanonPersonaMode: vi.fn(),
  setGuildDefaultRecapStyle: vi.fn(),
  setGuildDmUserId: vi.fn(),
}));

vi.mock("../campaign/ensureGuildSetup.js", () => ({
  ensureGuildSetup: vi.fn(async () => ({
    applied: [],
    warnings: [],
    errors: [],
    setupVersionChanged: false,
    canAttemptVoice: false,
  })),
}));

vi.mock("../config/env.js", () => ({
  cfg: {
    tts: { enabled: false },
    overlay: { homeVoiceChannelId: null },
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

vi.mock("../personas/index.js", () => ({
  getPersona: vi.fn(() => ({ displayName: "Meta Meepo" })),
}));

vi.mock("../ledger/system.js", () => ({
  logSystemEvent: vi.fn(),
}));

vi.mock("../meepo/state.js", () => ({
  getActiveMeepo: vi.fn(() => ({ id: "active", reply_mode: "text" })),
  wakeMeepo: vi.fn(),
  sleepMeepo: vi.fn(() => 1),
}));

vi.mock("../meepo/personaState.js", () => ({
  getEffectivePersonaId: vi.fn(() => "meta_meepo"),
}));

vi.mock("../security/isElevated.js", () => ({
  isElevated: vi.fn(() => true),
}));

vi.mock("../sessions/recapService.js", () => ({
  generateSessionRecapContract: vi.fn(async () => buildCanonicalRecapContract()),
}));

vi.mock("../sessions/sessions.js", () => ({
  endSession: vi.fn(() => 1),
  getActiveSession: vi.fn(() => null),
  getMostRecentSession: vi.fn(() => null),
  getSessionById: vi.fn(() => sessionById),
  listSessions: vi.fn(() => (sessionById ? [sessionById] : [])),
  startSession: vi.fn(),
  getSessionArtifact: vi.fn((_guildId: string, _sessionId: string, artifactType: string) => {
    if (artifactType === "recap_final") return recapArtifact;
    if (artifactType === "transcript_export") return transcriptArtifact;
    return null;
  }),
  getSessionArtifactMap: vi.fn(() => {
    const map = new Map<string, any>();
    if (sessionById && recapArtifact) map.set(sessionById.session_id, recapArtifact);
    return map;
  }),
  getSessionArtifactsForSession: vi.fn(() => (recapArtifact ? [recapArtifact] : [])),
  upsertSessionArtifact: vi.fn(),
}));

vi.mock("../sessions/transcriptExport.js", () => ({
  ensureBronzeTranscriptExportCached: ensureBronzeTranscriptExportCachedMock,
}));

vi.mock("../sessions/sessionRuntime.js", () => ({
  resolveEffectiveMode: vi.fn(() => "ambient"),
}));

vi.mock("../voice/connection.js", () => ({
  joinVoice: vi.fn(),
  leaveVoice: vi.fn(),
}));

vi.mock("../voice/receiver.js", () => ({
  startReceiver: vi.fn(),
  stopReceiver: vi.fn(),
}));

vi.mock("../voice/state.js", () => ({
  getVoiceState: vi.fn(() => null),
  isVoiceHushEnabled: vi.fn(() => true),
  setVoiceHushEnabled: vi.fn(),
  setVoiceState: vi.fn(),
}));

vi.mock("../voice/stt/provider.js", () => ({
  getSttProviderInfo: vi.fn(() => ({ name: "noop" })),
}));

vi.mock("../voice/tts/provider.js", () => ({
  getTtsProviderInfo: vi.fn(() => ({ name: "noop" })),
}));

vi.mock("../voice/voicePlaybackController.js", () => ({
  voicePlaybackController: { abort: vi.fn() },
}));

vi.mock("../ledger/meepoContextWorker.js", () => ({
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
  sessionById = { ...baseSession };
  recapArtifact = null;
  transcriptArtifact = {
    id: "transcript-1",
    session_id: "session-1",
    artifact_type: "transcript_export",
    created_at_ms: Date.now(),
    engine: "bronze_transcript_export_v1",
    source_hash: "tx-hash-1",
    strategy: "default",
    strategy_version: "v1",
    meta_json: "{}",
    content_text: "DM: Welcome",
    file_path: null,
    size_bytes: 12,
  };
  ensureBronzeTranscriptExportCachedMock.mockReset();
  ensureBronzeTranscriptExportCachedMock.mockImplementation(() => ({
    path: "transcript.log",
    bytes: 12,
    hash: "tx-hash-1",
    cacheHit: true,
  }));
  vi.clearAllMocks();
});

describe("/meepo sessions recap contract", () => {
  test("no top-level meepo recap subcommand exists", async () => {
    const { meepo } = await import("../commands/meepo.js");
    const json = meepo.data.toJSON();
    const rootOptions = (json.options ?? []) as any[];
    const topLevelRecap = rootOptions.find((opt: any) => opt.type === 1 && opt.name === "recap");
    expect(topLevelRecap).toBeUndefined();

    const sessionsGroup = rootOptions.find((opt: any) => opt.type === 2 && opt.name === "sessions") as any;
    const recapSub = (sessionsGroup?.options ?? []).find((opt: any) => opt.type === 1 && opt.name === "recap");
    expect(recapSub).toBeDefined();
  });

  test("sessions recap refuses ambient sessions", async () => {
    sessionById = {
      ...baseSession,
      kind: "chat",
      mode_at_start: "ambient",
      label: "Postgame",
    };

    const { meepo } = await import("../commands/meepo.js");
    const reply = vi.fn(async (_payload: any) => undefined);

    const interaction: any = {
      guildId: "guild-1",
      channelId: "text-1",
      guild: { voiceAdapterCreator: {} },
      user: { id: "user-1", username: "Tester" },
      member: {},
      options: {
        getSubcommandGroup: vi.fn(() => "sessions"),
        getSubcommand: vi.fn(() => "recap"),
        getString: vi.fn((_name: string) => "session-1"),
        getBoolean: vi.fn(() => false),
      },
      reply,
      deferReply: vi.fn(async () => undefined),
      editReply: vi.fn(async () => undefined),
    };

    await meepo.execute(interaction, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db: { prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(() => ({ ts: null })) })) },
    });

    expect(reply).toHaveBeenCalledTimes(1);
    const payload = reply.mock.calls.at(0)?.[0];
    expect(payload?.content).toContain("canon");
    expect(payload?.content).toContain("/meepo sessions list");
  });

  test("sessions recap persists recap artifact for canon session", async () => {
    const { meepo } = await import("../commands/meepo.js");
    const deferReply = vi.fn(async () => undefined);
    const editReply = vi.fn(async (_payload: any) => undefined);

    const interaction: any = {
      guildId: "guild-1",
      channelId: "text-1",
      guild: { voiceAdapterCreator: {} },
      user: { id: "user-1", username: "Tester" },
      member: {},
      options: {
        getSubcommandGroup: vi.fn(() => "sessions"),
        getSubcommand: vi.fn(() => "recap"),
        getString: vi.fn((name: string) => (name === "style" ? "balanced" : "session-1")),
        getBoolean: vi.fn(() => true),
      },
      reply: vi.fn(async () => undefined),
      deferReply,
      editReply,
    };

    await meepo.execute(interaction, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db: { prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(() => ({ ts: null })) })) },
    });

    expect(deferReply).toHaveBeenCalledTimes(1);
    expect(editReply).toHaveBeenCalledTimes(1);
    const payload = editReply.mock.calls.at(0)?.[0];
    expect(payload?.content).toContain("Recap");
    expect(payload?.content).toContain("Style:");
    expect(payload?.content).toContain("Preview");
    expect(Array.isArray(payload?.files)).toBe(true);
  });

  test("sessions recap short-circuits duplicate in-flight requests", async () => {
    sessionById = { ...baseSession, session_id: "session-inflight-1", label: "Arc Inflight" };
    const { generateSessionRecapContract } = await import("../sessions/recapService.js");
    let markStarted: (() => void) | null = null;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    vi.mocked(generateSessionRecapContract).mockImplementationOnce(async () => {
      markStarted?.();
      await new Promise((resolve) => setTimeout(resolve, 75));
      return buildCanonicalRecapContract();
    });

    const { meepo } = await import("../commands/meepo.js");

    const firstInteraction: any = {
      guildId: "guild-inflight-1",
      channelId: "text-1",
      guild: { voiceAdapterCreator: {} },
      user: { id: "user-1", username: "Tester" },
      member: {},
      options: {
        getSubcommandGroup: vi.fn(() => "sessions"),
        getSubcommand: vi.fn(() => "recap"),
        getString: vi.fn((name: string) => (name === "style" ? "balanced" : "session-inflight-1")),
        getBoolean: vi.fn(() => false),
      },
      reply: vi.fn(async () => undefined),
      deferReply: vi.fn(async () => undefined),
      editReply: vi.fn(async () => undefined),
    };

    const secondReply = vi.fn(async (_payload: any) => undefined);
    const secondInteraction: any = {
      guildId: "guild-inflight-1",
      channelId: "text-1",
      guild: { voiceAdapterCreator: {} },
      user: { id: "user-2", username: "Tester2" },
      member: {},
      options: {
        getSubcommandGroup: vi.fn(() => "sessions"),
        getSubcommand: vi.fn(() => "recap"),
        getString: vi.fn((name: string) => (name === "style" ? "balanced" : "session-inflight-1")),
        getBoolean: vi.fn(() => true),
      },
      reply: secondReply,
      deferReply: vi.fn(async () => undefined),
      editReply: vi.fn(async () => undefined),
    };

    const ctx = {
      guildId: "guild-inflight-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db: { prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(() => ({ ts: null })) })) },
    };

    const firstCall = meepo.execute(firstInteraction, ctx);
    await started;

    await meepo.execute(secondInteraction, ctx);

    expect(generateSessionRecapContract).toHaveBeenCalledTimes(1);
    expect(secondReply).toHaveBeenCalledTimes(1);
    const secondPayload = secondReply.mock.calls.at(0)?.[0];
    expect(secondPayload?.content).toContain("already being generated");

    await firstCall;
  });

  test("sessions recap cooldown blocks immediate repeat request", async () => {
    sessionById = { ...baseSession, session_id: "session-cooldown-1", label: "Arc Cooldown" };

    const { generateSessionRecapContract } = await import("../sessions/recapService.js");
    const { meepo } = await import("../commands/meepo.js");

    const ctx = {
      guildId: "guild-cooldown-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db: { prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(() => ({ ts: null })) })) },
    };

    const firstInteraction: any = {
      guildId: "guild-cooldown-1",
      channelId: "text-1",
      guild: { voiceAdapterCreator: {} },
      user: { id: "user-1", username: "Tester" },
      member: {},
      options: {
        getSubcommandGroup: vi.fn(() => "sessions"),
        getSubcommand: vi.fn(() => "recap"),
        getString: vi.fn((name: string) => (name === "style" ? "balanced" : "session-cooldown-1")),
        getBoolean: vi.fn(() => false),
      },
      reply: vi.fn(async () => undefined),
      deferReply: vi.fn(async () => undefined),
      editReply: vi.fn(async () => undefined),
    };

    const secondReply = vi.fn(async (_payload: any) => undefined);
    const secondInteraction: any = {
      guildId: "guild-cooldown-1",
      channelId: "text-1",
      guild: { voiceAdapterCreator: {} },
      user: { id: "user-2", username: "Tester2" },
      member: {},
      options: {
        getSubcommandGroup: vi.fn(() => "sessions"),
        getSubcommand: vi.fn(() => "recap"),
        getString: vi.fn((name: string) => (name === "style" ? "balanced" : "session-cooldown-1")),
        getBoolean: vi.fn(() => false),
      },
      reply: secondReply,
      deferReply: vi.fn(async () => undefined),
      editReply: vi.fn(async () => undefined),
    };

    await meepo.execute(firstInteraction, ctx);
    await meepo.execute(secondInteraction, ctx);

    expect(generateSessionRecapContract).toHaveBeenCalledTimes(1);
    expect(secondReply).toHaveBeenCalledTimes(1);
    const payload = secondReply.mock.calls.at(0)?.[0];
    expect(payload?.content).toContain("requested very recently");
    expect(payload?.content).toContain("seconds");
  });

  test("sessions recap force does not bypass hard concurrency cap", async () => {
    sessionById = { ...baseSession, session_id: "session-cap-1", label: "Arc Cap" };

    const { generateSessionRecapContract } = await import("../sessions/recapService.js");
    let releaseRecap!: (value: any) => void;
    const blockedRecap = new Promise<any>((resolve) => {
      releaseRecap = resolve;
    });
    vi.mocked(generateSessionRecapContract).mockImplementationOnce(async () => blockedRecap);

    const { meepo } = await import("../commands/meepo.js");

    const ctx = {
      guildId: "guild-cap-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db: { prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(() => ({ ts: null })) })) },
    };

    const firstCall = meepo.execute(
      {
        guildId: "guild-cap-1",
        channelId: "text-1",
        guild: { voiceAdapterCreator: {} },
        user: { id: "user-1", username: "Tester" },
        member: {},
        options: {
          getSubcommandGroup: vi.fn(() => "sessions"),
          getSubcommand: vi.fn(() => "recap"),
          getString: vi.fn((name: string) => (name === "style" ? "balanced" : "session-cap-1")),
          getBoolean: vi.fn(() => false),
        },
        reply: vi.fn(async () => undefined),
        deferReply: vi.fn(async () => undefined),
        editReply: vi.fn(async () => undefined),
      } as any,
      ctx
    );
    await Promise.resolve();

    const secondReply = vi.fn(async (_payload: any) => undefined);
    await meepo.execute(
      {
        guildId: "guild-cap-1",
        channelId: "text-1",
        guild: { voiceAdapterCreator: {} },
        user: { id: "user-2", username: "Tester2" },
        member: {},
        options: {
          getSubcommandGroup: vi.fn(() => "sessions"),
          getSubcommand: vi.fn(() => "recap"),
          getString: vi.fn((name: string) => (name === "style" ? "concise" : "session-cap-1")),
          getBoolean: vi.fn(() => true),
        },
        reply: secondReply,
        deferReply: vi.fn(async () => undefined),
        editReply: vi.fn(async () => undefined),
      } as any,
      ctx
    );

    expect(generateSessionRecapContract).toHaveBeenCalledTimes(1);
    const payload = secondReply.mock.calls.at(0)?.[0];
    expect(payload?.content).toContain("at capacity");

    releaseRecap(buildCanonicalRecapContract());
    await firstCall;
  });

  test("sessions recap force bypasses cooldown and logs bypass", async () => {
    sessionById = { ...baseSession, session_id: "session-cooldown-force", label: "Arc Force" };

    const { generateSessionRecapContract } = await import("../sessions/recapService.js");
    const { logSystemEvent } = await import("../ledger/system.js");
    const { meepo } = await import("../commands/meepo.js");

    const ctx = {
      guildId: "guild-cooldown-force",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db: { prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(() => ({ ts: null })) })) },
    };

    const firstInteraction: any = {
      guildId: "guild-cooldown-force",
      channelId: "text-1",
      guild: { voiceAdapterCreator: {} },
      user: { id: "user-1", username: "Tester" },
      member: {},
      options: {
        getSubcommandGroup: vi.fn(() => "sessions"),
        getSubcommand: vi.fn(() => "recap"),
        getString: vi.fn((name: string) => (name === "style" ? "balanced" : "session-cooldown-force")),
        getBoolean: vi.fn(() => false),
      },
      reply: vi.fn(async () => undefined),
      deferReply: vi.fn(async () => undefined),
      editReply: vi.fn(async () => undefined),
    };

    const secondReply = vi.fn(async (_payload: any) => undefined);
    const secondInteraction: any = {
      guildId: "guild-cooldown-force",
      channelId: "text-1",
      guild: { voiceAdapterCreator: {} },
      user: { id: "user-2", username: "Tester2" },
      member: {},
      options: {
        getSubcommandGroup: vi.fn(() => "sessions"),
        getSubcommand: vi.fn(() => "recap"),
        getString: vi.fn((name: string) => (name === "style" ? "balanced" : "session-cooldown-force")),
        getBoolean: vi.fn(() => true),
      },
      reply: secondReply,
      deferReply: vi.fn(async () => undefined),
      editReply: vi.fn(async () => undefined),
    };

    await meepo.execute(firstInteraction, ctx);
    await meepo.execute(secondInteraction, ctx);

    expect(generateSessionRecapContract).toHaveBeenCalledTimes(2);
    expect(secondReply).not.toHaveBeenCalled();

    const bypassEvent = vi
      .mocked(logSystemEvent)
      .mock.calls.find((call) => call[0]?.eventType === "SESSION_RECAP_COOLDOWN_BYPASSED");
    expect(bypassEvent).toBeTruthy();
  });

  test("sessions recap cooldown key is scoped by session and guild", async () => {
    const { generateSessionRecapContract } = await import("../sessions/recapService.js");
    const { meepo } = await import("../commands/meepo.js");

    const baseCtx = {
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db: { prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(() => ({ ts: null })) })) },
    };

    // First request seeds cooldown for guild-scope-1/session-scope-1/balanced
    sessionById = { ...baseSession, session_id: "session-scope-1", label: "Arc Scope 1" };
    await meepo.execute(
      {
        guildId: "guild-scope-1",
        channelId: "text-1",
        guild: { voiceAdapterCreator: {} },
        user: { id: "user-1", username: "Tester" },
        member: {},
        options: {
          getSubcommandGroup: vi.fn(() => "sessions"),
          getSubcommand: vi.fn(() => "recap"),
          getString: vi.fn((name: string) => (name === "style" ? "balanced" : "session-scope-1")),
          getBoolean: vi.fn(() => false),
        },
        reply: vi.fn(async () => undefined),
        deferReply: vi.fn(async () => undefined),
        editReply: vi.fn(async () => undefined),
      } as any,
      { ...baseCtx, guildId: "guild-scope-1" }
    );

    // Different session same guild should not be blocked.
    sessionById = { ...baseSession, session_id: "session-scope-2", label: "Arc Scope 2" };
    await meepo.execute(
      {
        guildId: "guild-scope-1",
        channelId: "text-1",
        guild: { voiceAdapterCreator: {} },
        user: { id: "user-2", username: "Tester2" },
        member: {},
        options: {
          getSubcommandGroup: vi.fn(() => "sessions"),
          getSubcommand: vi.fn(() => "recap"),
          getString: vi.fn((name: string) => (name === "style" ? "balanced" : "session-scope-2")),
          getBoolean: vi.fn(() => false),
        },
        reply: vi.fn(async () => undefined),
        deferReply: vi.fn(async () => undefined),
        editReply: vi.fn(async () => undefined),
      } as any,
      { ...baseCtx, guildId: "guild-scope-1" }
    );

    // Same session id but different guild should not be blocked.
    sessionById = { ...baseSession, session_id: "session-scope-1", label: "Arc Scope 1" };
    await meepo.execute(
      {
        guildId: "guild-scope-2",
        channelId: "text-1",
        guild: { voiceAdapterCreator: {} },
        user: { id: "user-3", username: "Tester3" },
        member: {},
        options: {
          getSubcommandGroup: vi.fn(() => "sessions"),
          getSubcommand: vi.fn(() => "recap"),
          getString: vi.fn((name: string) => (name === "style" ? "balanced" : "session-scope-1")),
          getBoolean: vi.fn(() => false),
        },
        reply: vi.fn(async () => undefined),
        deferReply: vi.fn(async () => undefined),
        editReply: vi.fn(async () => undefined),
      } as any,
      { ...baseCtx, guildId: "guild-scope-2" }
    );

    expect(generateSessionRecapContract).toHaveBeenCalledTimes(3);
  });

  test("sessions view shows most recent final style", async () => {
    recapArtifact = {
      id: "artifact-1",
      session_id: "session-1",
      artifact_type: "recap_final",
      created_at_ms: Date.now(),
      source_hash: "hash-1",
      strategy: "concise",
      strategy_version: "megameecap-final-v1",
      meta_json: JSON.stringify({
        final_style: "concise",
        final_version: "megameecap-final-v1",
        base_version: "megameecap-base-v1",
      }),
      content_text: "# Recap\n\nFinal concise recap",
      file_path: null,
      size_bytes: 20,
    };

    const { meepo } = await import("../commands/meepo.js");
    const reply = vi.fn(async (_payload: any) => undefined);

    const interaction: any = {
      guildId: "guild-1",
      channelId: "text-1",
      guild: { voiceAdapterCreator: {} },
      user: { id: "user-1", username: "Tester" },
      member: {},
      options: {
        getSubcommandGroup: vi.fn(() => "sessions"),
        getSubcommand: vi.fn(() => "view"),
        getString: vi.fn(() => "session-1"),
        getBoolean: vi.fn(() => false),
      },
      reply,
    };

    await meepo.execute(interaction, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db: { prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(() => ({ ts: null })) })) },
    });

    const payload = reply.mock.calls.at(0)?.[0];
    expect(payload?.content).toContain("Recap");
    expect(payload?.content).toContain("Final:");
    expect(payload?.content).toContain("concise");
  });

  test("sessions view uses taxonomy when requested session does not exist", async () => {
    sessionById = null;
    const { meepo } = await import("../commands/meepo.js");
    const reply = vi.fn(async (_payload: any) => undefined);

    const interaction: any = {
      guildId: "guild-1",
      channelId: "text-1",
      guild: { voiceAdapterCreator: {} },
      user: { id: "user-1", username: "Tester" },
      member: {},
      options: {
        getSubcommandGroup: vi.fn(() => "sessions"),
        getSubcommand: vi.fn(() => "view"),
        getString: vi.fn(() => "missing-session"),
      },
      reply,
    };

    await meepo.execute(interaction, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db: { prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(() => ({ ts: null })) })) },
    });

    const payload = reply.mock.calls.at(0)?.[0];
    expect(payload?.content).toContain("(ERR_NO_ACTIVE_SESSION)");
    expect(payload?.content).toContain("/meepo sessions list");
  });

  test("sessions view maps transcript export failure to transcript unavailable taxonomy", async () => {
    ensureBronzeTranscriptExportCachedMock.mockImplementationOnce(() => {
      throw new Error("No bronze transcript data found for session session-1");
    });

    const { meepo } = await import("../commands/meepo.js");
    const reply = vi.fn(async (_payload: any) => undefined);

    const interaction: any = {
      guildId: "guild-1",
      channelId: "text-1",
      guild: { voiceAdapterCreator: {} },
      user: { id: "user-1", username: "Tester" },
      member: {},
      options: {
        getSubcommandGroup: vi.fn(() => "sessions"),
        getSubcommand: vi.fn(() => "view"),
        getString: vi.fn(() => "session-1"),
      },
      reply,
    };

    await meepo.execute(interaction, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db: { prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(() => ({ ts: null })) })) },
    });

    const payload = reply.mock.calls.at(0)?.[0];
    expect(payload?.content).toContain("(ERR_TRANSCRIPT_UNAVAILABLE)");
    expect(payload?.content).toContain("transcript export");
  });

  test("sessions view maps transcript time budget expiration to stale interaction taxonomy", async () => {
    ensureBronzeTranscriptExportCachedMock.mockImplementationOnce(() => {
      throw new Error("transcript_export_time_budget_exceeded:pre_build");
    });

    const { meepo } = await import("../commands/meepo.js");
    const reply = vi.fn(async (_payload: any) => undefined);

    const interaction: any = {
      guildId: "guild-1",
      channelId: "text-1",
      guild: { voiceAdapterCreator: {} },
      user: { id: "user-1", username: "Tester" },
      member: {},
      options: {
        getSubcommandGroup: vi.fn(() => "sessions"),
        getSubcommand: vi.fn(() => "view"),
        getString: vi.fn(() => "session-1"),
      },
      reply,
    };

    await meepo.execute(interaction, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db: { prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(() => ({ ts: null })) })) },
    });

    const payload = reply.mock.calls.at(0)?.[0];
    expect(payload?.content).toContain("(ERR_STALE_INTERACTION)");
    expect(payload?.content).toContain("from scratch");
  });

  test("sessions view maps missing transcript artifact to transcript unavailable taxonomy", async () => {
    transcriptArtifact = null;

    const { meepo } = await import("../commands/meepo.js");
    const reply = vi.fn(async (_payload: any) => undefined);

    const interaction: any = {
      guildId: "guild-1",
      channelId: "text-1",
      guild: { voiceAdapterCreator: {} },
      user: { id: "user-1", username: "Tester" },
      member: {},
      options: {
        getSubcommandGroup: vi.fn(() => "sessions"),
        getSubcommand: vi.fn(() => "view"),
        getString: vi.fn(() => "session-1"),
      },
      reply,
    };

    await meepo.execute(interaction, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db: { prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(() => ({ ts: null })) })) },
    });

    const payload = reply.mock.calls.at(0)?.[0];
    expect(payload?.content).toContain("(ERR_TRANSCRIPT_UNAVAILABLE)");
    expect(payload?.content).toContain("no transcript artifact");
  });
});
