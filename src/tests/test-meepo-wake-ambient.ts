import { afterEach, describe, expect, test, vi } from "vitest";

let activeSession: { session_id: string; label: string | null; started_at_ms: number; ended_at_ms: number | null } | null = {
  session_id: "session-123",
  label: null,
  started_at_ms: Date.now() - 60_000,
  ended_at_ms: null,
};

const endSessionMock = vi.fn((guildId: string, reason: string | null = null) => {
  if (activeSession) {
    activeSession = { ...activeSession, ended_at_ms: Date.now() };
  }
  activeSession = null;
  return 1;
});

const startSessionMock = vi.fn();
const logSystemEventMock = vi.fn();
const wakeMeepoMock = vi.fn();

vi.mock("../campaign/guildConfig.js", () => {
  let homeText: string | null = null;
  return {
    getGuildCanonPersonaId: vi.fn(() => null),
    getGuildCanonPersonaMode: vi.fn(() => "meta"),
    getGuildDmUserId: vi.fn(() => null),
    getGuildConfig: vi.fn(() => ({ campaign_slug: "default" })),
    getGuildDefaultRecapStyle: vi.fn(() => "balanced"),
    getGuildHomeTextChannelId: vi.fn(() => homeText),
    setGuildHomeTextChannelId: vi.fn((_guildId: string, channelId: string | null) => {
      homeText = channelId;
    }),
    getGuildHomeVoiceChannelId: vi.fn(() => null),
    getGuildSetupVersion: vi.fn(() => 1),
    setGuildHomeVoiceChannelId: vi.fn(),
    resolveGuildHomeVoiceChannelId: vi.fn(() => null),
    setGuildCanonPersonaId: vi.fn(),
    setGuildCanonPersonaMode: vi.fn(),
    setGuildDefaultRecapStyle: vi.fn(),
    setGuildDmUserId: vi.fn(),
  };
});

vi.mock("../campaign/ensureGuildSetup.js", () => ({
  ensureGuildSetup: vi.fn(async () => ({
    applied: ["Bound home text to <#text-1>"],
    warnings: ["Missing Connect/Speak permission in home voice channel"],
    errors: [],
    setupVersionChanged: true,
    canAttemptVoice: false,
  })),
}));

vi.mock("../config/env.js", () => ({
  cfg: {
    logging: { level: "warn", scopes: [], format: "pretty" },
    voice: { debug: false },
    tts: { enabled: false },
    overlay: { homeVoiceChannelId: null },
  },
}));

vi.mock("../personas/index.js", () => ({
  getPersona: vi.fn(() => ({ displayName: "Meta Meepo" })),
}));

vi.mock("../ledger/system.js", () => ({
  logSystemEvent: logSystemEventMock,
}));

vi.mock("../meepo/state.js", () => ({
  getActiveMeepo: vi.fn(() => ({ id: "active-meepo", reply_mode: "text" })),
  wakeMeepo: wakeMeepoMock,
  sleepMeepo: vi.fn(() => 1),
}));

vi.mock("../meepo/personaState.js", () => ({
  getEffectivePersonaId: vi.fn(() => "meta_meepo"),
}));

vi.mock("../security/isElevated.js", () => ({
  isElevated: vi.fn(() => true),
}));

vi.mock("../sessions/sessions.js", () => ({
  endSession: endSessionMock,
  getActiveSession: vi.fn(() => activeSession),
  getMostRecentSession: vi.fn(() => activeSession),
  getSessionById: vi.fn(() => activeSession),
  listSessions: vi.fn(() => []),
  getSessionArtifactMap: vi.fn(() => new Map()),
  getSessionArtifactsForSession: vi.fn(() => []),
  startSession: startSessionMock,
}));

vi.mock("../sessions/sessionRuntime.js", () => ({
  resolveEffectiveMode: vi.fn(() => (activeSession ? "canon" : "ambient")),
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
  activeSession = {
    session_id: "session-123",
    label: null,
    started_at_ms: Date.now() - 60_000,
    ended_at_ms: null,
  };
  vi.clearAllMocks();
});

describe("/meepo wake ambient behavior", () => {
  test("wake without session label ends active session and reports ambient mode", async () => {
    const { meepo } = await import("../commands/meepo.js");

    const reply = vi.fn(async (_payload: { content: string; ephemeral: boolean }) => undefined);

    const interaction: any = {
      guildId: "guild-1",
      channelId: "text-1",
      guild: {
        voiceAdapterCreator: {},
        members: {
          fetch: vi.fn(async () => ({ voice: { channelId: null } })),
        },
      },
      user: { id: "user-1", username: "Tester" },
      member: {},
      options: {
        getSubcommandGroup: vi.fn(() => null),
        getSubcommand: vi.fn(() => "wake"),
        getString: vi.fn(() => null),
      },
      reply,
    };

    await meepo.execute(interaction, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db: {
        prepare: vi.fn(() => ({
          run: vi.fn(),
          get: vi.fn(() => ({ ts: null })),
        })),
      },
    });

    expect(endSessionMock).toHaveBeenCalledTimes(1);
    expect(endSessionMock).toHaveBeenCalledWith("guild-1", "wake_ambient");
    expect(startSessionMock).not.toHaveBeenCalled();
    expect(logSystemEventMock).toHaveBeenCalled();

    expect(reply).toHaveBeenCalledTimes(1);
    const payload = reply.mock.calls.at(0)?.[0] as { content: string; ephemeral: boolean } | undefined;
    expect(payload).toBeDefined();
    expect(payload?.content).toContain("Ambient");
    expect(payload?.content).not.toContain("Mode: Canon (");
    expect(payload?.content).toContain("voice");
    expect(payload?.content).toContain("⚠️");
  });

  test("wake does not call voice connect when setup marks voice unavailable", async () => {
    const { meepo } = await import("../commands/meepo.js");
    const voiceConnection = await import("../voice/connection.js");

    const reply = vi.fn(async (_payload: { content: string; ephemeral: boolean }) => undefined);
    const interaction: any = {
      guildId: "guild-1",
      channelId: "text-1",
      guild: {
        voiceAdapterCreator: {},
        members: {
          fetch: vi.fn(async () => ({ voice: { channelId: "voice-1" } })),
        },
      },
      user: { id: "user-1", username: "Tester" },
      member: {},
      options: {
        getSubcommandGroup: vi.fn(() => null),
        getSubcommand: vi.fn(() => "wake"),
        getString: vi.fn(() => null),
      },
      reply,
    };

    await meepo.execute(interaction, {
      guildId: "guild-1",
      campaignSlug: "default",
      dbPath: "test.sqlite",
      db: {
        prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(() => ({ ts: null })) })),
      },
    });

    expect(voiceConnection.joinVoice).not.toHaveBeenCalled();
  });
});
