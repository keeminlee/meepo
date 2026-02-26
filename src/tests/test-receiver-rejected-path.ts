import { afterEach, expect, test, vi } from "vitest";

const appendLedgerEntryMock = vi.fn();
const respondToVoiceUtteranceMock = vi.fn();
const chatMock = vi.fn();

vi.mock("../ledger/ledger.js", () => ({
  appendLedgerEntry: appendLedgerEntryMock,
}));

vi.mock("../voice/voiceReply.js", () => ({
  respondToVoiceUtterance: respondToVoiceUtteranceMock,
}));

vi.mock("../llm/client.js", () => ({
  chat: chatMock,
}));

function configureEnv(): void {
  vi.stubEnv("DISCORD_TOKEN", "test-token");
  vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
  vi.stubEnv("STT_MIN_AUDIO_MS", "300");
  vi.stubEnv("STT_MIN_ACTIVE_RATIO", "0.35");
  vi.stubEnv("STT_NO_SPEECH_PROB_MAX", "0.6");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  appendLedgerEntryMock.mockReset();
  respondToVoiceUtteranceMock.mockReset();
  chatMock.mockReset();
});

test("rejected path bypasses ledger + llm + reply", async () => {
  configureEnv();

  const { processTranscribedVoiceText } = await import("../voice/receiver.js");

  const result = await processTranscribedVoiceText({
    guildId: "guild-1",
    channelId: "channel-1",
    userId: "user-1",
    displayName: "User One",
    text: "um",
    confidence: 0.22,
    sttMeta: {
      noSpeechProb: 0.82,
    },
    cap: { startedAt: Date.now() },
    audioMs: 420,
    activeMs: 70,
    isBargeIn: true,
    audioPath: null,
  });

  expect(result.accepted).toBe(false);
  expect(result.reasons.length).toBeGreaterThan(0);
  expect(appendLedgerEntryMock).not.toHaveBeenCalled();
  expect(respondToVoiceUtteranceMock).not.toHaveBeenCalled();
  expect(chatMock).not.toHaveBeenCalled();
});
