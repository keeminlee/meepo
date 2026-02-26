import { afterEach, expect, test, vi } from "vitest";

function configureEnv(): void {
  vi.stubEnv("DISCORD_TOKEN", "test-token");
  vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
  vi.stubEnv("BARGE_IN_MODE", "immediate");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

test("voice interrupt: barge-in aborts active playback and clears speaking", async () => {
  configureEnv();
  const { voicePlaybackController } = await import("../../voice/voicePlaybackController.js");

  const abortReasons: string[] = [];
  voicePlaybackController.registerAbortHandler("interrupt-guild", (reason) => {
    abortReasons.push(reason);
  });

  expect(voicePlaybackController.onUserSpeechStart("interrupt-guild", { source: "voice" })).toBe(false);

  voicePlaybackController.setIsSpeaking("interrupt-guild", true);
  expect(voicePlaybackController.onUserSpeechStart("interrupt-guild", { source: "voice" })).toBe(true);

  expect(abortReasons).toEqual(["user_speech_override"]);
  expect(voicePlaybackController.getIsSpeaking("interrupt-guild")).toBe(false);

  voicePlaybackController.resetGuild("interrupt-guild");
});