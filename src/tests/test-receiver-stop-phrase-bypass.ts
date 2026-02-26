import { afterEach, expect, test, vi } from "vitest";

const abortMock = vi.fn();
const appendLedgerEntryMock = vi.fn();
const respondToVoiceUtteranceMock = vi.fn();
const chatMock = vi.fn();

vi.mock("../voice/voicePlaybackController.js", () => ({
  voicePlaybackController: {
    abort: abortMock,
    onUserSpeechStart: vi.fn(),
    getIsSpeaking: vi.fn(() => false),
  },
}));

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
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  abortMock.mockReset();
  appendLedgerEntryMock.mockReset();
  respondToVoiceUtteranceMock.mockReset();
  chatMock.mockReset();
});

test("receiver stop phrase bypasses LLM + ledger + reply", async () => {
  configureEnv();

  const { processTranscribedVoiceText } = await import("../voice/receiver.js");

  const firstResult = await processTranscribedVoiceText({
    guildId: "guild-1",
    channelId: "channel-1",
    userId: "user-1",
    displayName: "User One",
    text: "meepo stop",
    confidence: 0.95,
    sttMeta: undefined,
    cap: { startedAt: Date.now() },
    audioMs: 450,
    activeMs: 320,
    isBargeIn: false,
    audioPath: null,
  });

  const secondResult = await processTranscribedVoiceText({
    guildId: "guild-1",
    channelId: "channel-1",
    userId: "user-1",
    displayName: "User One",
    text: "meepo stop please",
    confidence: 0.95,
    sttMeta: undefined,
    cap: { startedAt: Date.now() },
    audioMs: 450,
    activeMs: 320,
    isBargeIn: false,
    audioPath: null,
  });

  expect(firstResult.accepted).toBe(false);
  expect(secondResult.accepted).toBe(false);

  expect(abortMock).toHaveBeenCalledTimes(2);
  expect(abortMock).toHaveBeenNthCalledWith(
    1,
    "guild-1",
    "explicit_stop_phrase",
    expect.objectContaining({ phrase: "meepo stop" })
  );
  expect(abortMock).toHaveBeenNthCalledWith(
    2,
    "guild-1",
    "explicit_stop_phrase",
    expect.objectContaining({ phrase: "meepo stop please" })
  );

  expect(appendLedgerEntryMock).not.toHaveBeenCalled();
  expect(respondToVoiceUtteranceMock).not.toHaveBeenCalled();
  expect(chatMock).not.toHaveBeenCalled();
});
