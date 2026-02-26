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

test("onUserSpeechStart aborts active playback and clears speaking state", async () => {
  configureEnv();

  const { voicePlaybackController } = await import("../voice/voicePlaybackController.js");

  const abortReasons: string[] = [];
  voicePlaybackController.registerAbortHandler("g1", (reason) => {
    abortReasons.push(reason);
  });

  voicePlaybackController.setIsSpeaking("g1", true);
  voicePlaybackController.onUserSpeechStart("g1", { source: "voice" });

  expect(abortReasons).toEqual(["user_speech_override"]);
  expect(voicePlaybackController.getIsSpeaking("g1")).toBe(false);

  voicePlaybackController.resetGuild("g1");
});

test("rapid speak-abort cycles resolve without promise rejection", async () => {
  configureEnv();

  const { voicePlaybackController } = await import("../voice/voicePlaybackController.js");

  voicePlaybackController.registerAbortHandler("g2", () => {});

  for (let i = 0; i < 12; i++) {
    const playbackPromise = voicePlaybackController.speak("g2", async ({ signal }) => {
      voicePlaybackController.setIsSpeaking("g2", true);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => resolve(), 25);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true }
        );
      });
    });

    voicePlaybackController.abort("g2", "test_abort");

    await expect(playbackPromise).resolves.toBeUndefined();
    expect(voicePlaybackController.getIsSpeaking("g2")).toBe(false);
  }

  voicePlaybackController.resetGuild("g2");
});
