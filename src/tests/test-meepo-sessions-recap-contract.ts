import { afterEach, describe, expect, test, vi } from "vitest";

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
    overlay: { port: 7777, homeVoiceChannelId: null },
    data: { root: ".", campaignsDir: "campaigns" },
    db: { filename: "db.sqlite", path: "db.sqlite" },
    voice: { debug: false },
    logging: {
      level: "error",
      scopes: [],
      format: "pretty",
      debugLatch: false,
    },
    access: { devUserIds: [] },
    mode: "ambient",
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
  generateSessionRecapContract: vi.fn(),
}));

vi.mock("../sessions/sessions.js", () => ({
  endSession: vi.fn(() => 1),
  getActiveSession: vi.fn(() => null),
  getMostRecentSession: vi.fn(() => null),
  getSessionById: vi.fn(() => null),
  listSessions: vi.fn(() => []),
  startSession: vi.fn(),
  getSessionArtifact: vi.fn(() => null),
  getSessionArtifactMap: vi.fn(() => new Map()),
  getSessionArtifactsForSession: vi.fn(() => []),
  upsertSessionArtifact: vi.fn(),
}));

vi.mock("../sessions/transcriptExport.js", () => ({
  ensureBronzeTranscriptExportCached: vi.fn(),
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
  vi.clearAllMocks();
});

function buildCtx() {
  return {
    guildId: "guild-1",
    campaignSlug: "default",
    dbPath: "test.sqlite",
    db: { prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(() => ({ ts: null })) })) },
  };
}

function buildInteraction(subcommand: "recap" | "view") {
  const reply = vi.fn(async (_payload: any) => undefined);
  return {
    guildId: "guild-1",
    channelId: "text-1",
    guild: { voiceAdapterCreator: {} },
    user: { id: "user-1", username: "Tester" },
    member: {},
    options: {
      getSubcommandGroup: vi.fn(() => "sessions"),
      getSubcommand: vi.fn(() => subcommand),
      getString: vi.fn(() => "session-1"),
      getBoolean: vi.fn(() => false),
    },
    reply,
  };
}

describe("retired sessions recap surface", () => {
  test("no public sessions group exists on the compatibility meepo export", async () => {
    const { meepo } = await import("../commands/meepo.js");
    const json = meepo.data.toJSON();
    const rootOptions = (json.options ?? []) as any[];

    const topLevelRecap = rootOptions.find((opt: any) => opt.type === 1 && opt.name === "recap");
    const sessionsGroup = rootOptions.find((opt: any) => opt.type === 2 && opt.name === "sessions");

    expect(topLevelRecap).toBeUndefined();
    expect(sessionsGroup).toBeUndefined();
  });

  test("stale sessions recap invocation returns retirement guidance", async () => {
    const { meepo } = await import("../commands/meepo.js");
    const interaction = buildInteraction("recap");

    await meepo.execute(interaction as any, buildCtx() as any);

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    const payload = (interaction.reply as any).mock.calls.at(0)?.[0];
    expect(payload?.content).toContain("retired from the Closed Alpha public surface");
    expect(payload?.content).toContain("/starstory status");
    expect(payload?.content).toContain("web app");
    expect(payload?.ephemeral).toBe(true);
  });

  test("stale sessions view invocation returns the same retirement guidance", async () => {
    const { meepo } = await import("../commands/meepo.js");
    const interaction = buildInteraction("view");

    await meepo.execute(interaction as any, buildCtx() as any);

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    const payload = (interaction.reply as any).mock.calls.at(0)?.[0];
    expect(payload?.content).toContain("retired from the Closed Alpha public surface");
    expect(payload?.content).toContain("/starstory status");
    expect(payload?.ephemeral).toBe(true);
  });
});