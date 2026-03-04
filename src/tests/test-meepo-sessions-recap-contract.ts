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

vi.mock("../sessions/recapEngine.js", () => ({
  generateSessionRecap: vi.fn(async () => ({
    text: "# Recap\n\nGenerated recap",
    createdAtMs: Date.now(),
    strategy: "balanced",
    engine: "megameecap",
    strategyVersion: "megameecap-v1",
    sourceTranscriptHash: "hash-1",
    cacheHit: false,
    artifactPaths: {
      recapPath: "recap.md",
      metaPath: "recap.meta.json",
    },
    sourceRange: { startLine: 0, endLine: 10, lineCount: 11 },
  })),
}));

vi.mock("../sessions/sessions.js", () => ({
  endSession: vi.fn(() => 1),
  getActiveSession: vi.fn(() => null),
  getMostRecentSession: vi.fn(() => null),
  getSessionById: vi.fn(() => sessionById),
  listSessions: vi.fn(() => (sessionById ? [sessionById] : [])),
  startSession: vi.fn(),
  getSessionArtifact: vi.fn(() => recapArtifact),
  getSessionArtifactMap: vi.fn(() => {
    const map = new Map<string, any>();
    if (sessionById && recapArtifact) map.set(sessionById.session_id, recapArtifact);
    return map;
  }),
  getSessionArtifactsForSession: vi.fn(() => (recapArtifact ? [recapArtifact] : [])),
  upsertSessionArtifact: vi.fn(),
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
});
