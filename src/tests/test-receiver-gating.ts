import { afterEach, expect, test, vi } from "vitest";

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
});

test("evaluateClipGate rejects short static, rejects filler-only, and passes clean speech", async () => {
  configureEnv();

  const { evaluateClipGate } = await import("../voice/receiver.js");

  const staticReject = evaluateClipGate({
    audioMs: 180,
    activeMs: 20,
    text: "noise",
    flags: { isBargeIn: false, checkTextGates: true },
  });
  expect(staticReject.accepted).toBe(false);
  expect(staticReject.reasons.some((reason) => reason.includes("audio_too_short"))).toBe(true);

  const fillerReject = evaluateClipGate({
    audioMs: 420,
    activeMs: 260,
    text: "um",
    flags: { isBargeIn: false, checkTextGates: true },
  });
  expect(fillerReject.accepted).toBe(false);
  expect(fillerReject.reasons).toContain("filler_only");

  const cleanPass = evaluateClipGate({
    audioMs: 700,
    activeMs: 420,
    text: "please open the door",
    flags: { isBargeIn: false, checkTextGates: true },
  });
  expect(cleanPass.accepted).toBe(true);
  expect(cleanPass.reasons).toHaveLength(0);
});
