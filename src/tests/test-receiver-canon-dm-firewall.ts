import { afterEach, describe, expect, test, vi } from "vitest";

let guildMode: "canon" | "ambient" | "dormant" = "canon";
let dmUserId: string | null = "dm-1";

const appendLedgerEntryMock = vi.fn();
const respondToVoiceUtteranceMock = vi.fn(() => Promise.resolve());

vi.mock("../utils/logger.js", () => ({
  log: {
    withScope: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  },
}));

vi.mock("../overlay/server.js", () => ({
  overlayEmitSpeaking: vi.fn(),
}));

vi.mock("../voice/state.js", () => ({
  getVoiceState: vi.fn(() => ({ hushEnabled: false })),
}));

vi.mock("../registry/normalizeText.js", () => ({
  normalizeText: vi.fn((text: string) => text),
}));

vi.mock("../ledger/ledger.js", () => ({
  appendLedgerEntry: appendLedgerEntryMock,
}));

vi.mock("../voice/wakeword.js", () => ({
  isLatchAnchor: vi.fn(() => false),
  hasMeepoInLine: vi.fn(() => true),
}));

vi.mock("../voice/voiceReply.js", () => ({
  respondToVoiceUtterance: respondToVoiceUtteranceMock,
}));

vi.mock("../meepo/state.js", () => ({
  getActiveMeepo: vi.fn(() => ({ channel_id: "text-1" })),
}));

vi.mock("../meepo/personaState.js", () => ({
  getEffectivePersonaId: vi.fn(() => "meta_meepo"),
}));

vi.mock("../latch/latch.js", () => ({
  setLatch: vi.fn(),
  isLatchActive: vi.fn(() => false),
  DEFAULT_LATCH_SECONDS: 30,
  DEFAULT_MAX_LATCH_TURNS: 2,
}));

vi.mock("../sessions/sessions.js", () => ({
  getActiveSession: vi.fn(() => null),
}));

vi.mock("../sessions/sessionRuntime.js", () => ({
  getGuildMode: vi.fn(() => guildMode),
}));

vi.mock("../campaign/guildConfig.js", () => ({
  getGuildDmUserId: vi.fn(() => dmUserId),
}));

vi.mock("../config/env.js", () => ({
  cfg: {
    logging: {
      level: "warn",
      scopes: [],
      format: "pretty",
    },
    voice: {
      endSilenceMs: 700,
      interruptActiveMs: 120,
    },
    stt: {
      minAudioMs: 300,
      minActiveRatio: 0.3,
      noSpeechProbMax: 0.9,
      saveAudio: false,
    },
  },
}));

vi.mock("../voice/voicePlaybackController.js", () => ({
  voicePlaybackController: {
    abort: vi.fn(),
    onUserSpeechStart: vi.fn(),
    getIsSpeaking: vi.fn(() => false),
  },
}));

afterEach(() => {
  guildMode = "canon";
  dmUserId = "dm-1";
  appendLedgerEntryMock.mockReset();
  respondToVoiceUtteranceMock.mockReset();
  vi.clearAllMocks();
  vi.resetModules();
});

async function processVoice(userId: string) {
  const { processTranscribedVoiceText } = await import("../voice/receiver.js");
  return processTranscribedVoiceText({
    guildId: "guild-1",
    channelId: "voice-1",
    userId,
    displayName: userId === "dm-1" ? "Keemin" : "Jamison",
    text: "hey meepo can you help",
    confidence: 0.91,
    sttMeta: { noSpeechProb: 0.1, avgLogprob: -0.2 },
    cap: { startedAt: Date.now() },
    audioMs: 900,
    activeMs: 700,
    isBargeIn: false,
    audioPath: null,
  });
}

describe("receiver canon dm firewall", () => {
  test("canon mode: DM speech is ingested but does not trigger reply", async () => {
    const result = await processVoice("dm-1");

    expect(result.accepted).toBe(true);
    expect(appendLedgerEntryMock).toHaveBeenCalledTimes(1);
    expect(respondToVoiceUtteranceMock).not.toHaveBeenCalled();
  });

  test("canon mode: player speech still triggers reply", async () => {
    const result = await processVoice("user-2");

    expect(result.accepted).toBe(true);
    expect(appendLedgerEntryMock).toHaveBeenCalledTimes(1);
    expect(respondToVoiceUtteranceMock).toHaveBeenCalledTimes(1);
  });

  test("non-canon mode: DM speech behavior remains unchanged", async () => {
    guildMode = "ambient";

    const result = await processVoice("dm-1");

    expect(result.accepted).toBe(true);
    expect(appendLedgerEntryMock).toHaveBeenCalledTimes(1);
    expect(respondToVoiceUtteranceMock).toHaveBeenCalledTimes(1);
  });
});
