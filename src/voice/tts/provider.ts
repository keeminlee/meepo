/**
 * TTS Provider Interface (Phase 4 Task 4.1)
 *
 * Pluggable interface for text-to-speech synthesis.
 * Mirrors STT architecture: lazy-loaded, cached singleton, info display.
 *
 * Audio Strategy (chosen at 4.1):
 * - Option A (Preferred): OpenAI TTS → WAV/PCM 48k mono → Discord voice
 * - Option B (Fallback): OpenAI TTS → MP3 → prism-media decode → PCM → Discord
 *
 * Will confirm actual OpenAI endpoint behavior in Task 4.2.
 */

export interface TtsProvider {
  /**
   * Synthesize text to audio.
   * @param text Text to speak
   * @returns Audio buffer (WAV, PCM, or MP3 depending on provider)
   */
  synthesize(text: string): Promise<Buffer>;
}

/**
 * Get provider info for user-facing messages.
 */
export function getTtsProviderInfo(): { name: string; description: string } {
  const provider = process.env.TTS_PROVIDER ?? "noop";

  switch (provider) {
    case "noop":
      return { name: "noop", description: "text-to-speech disabled" };
    case "openai": {
      const model = process.env.TTS_OPENAI_MODEL ?? "gpt-4o-mini-tts";
      const voice = process.env.TTS_VOICE ?? "alloy";
      return {
        name: "openai",
        description: `OpenAI TTS (${model}, voice: ${voice})`,
      };
    }
    default:
      return { name: provider, description: "unknown TTS provider (using noop)" };
  }
}

/**
 * Get the configured TTS provider based on environment.
 * TTS_PROVIDER env var: "noop" | "openai"
 *
 * Providers are lazy-loaded and cached (single instance per bot lifetime).
 */

let providerPromise: Promise<TtsProvider> | null = null;

export async function getTtsProvider(): Promise<TtsProvider> {
  // Return cached promise if already initialized
  if (providerPromise) return providerPromise;

  const provider = process.env.TTS_PROVIDER ?? "noop";

  // Create the promise and cache it
  providerPromise = (async () => {
    switch (provider) {
      case "openai": {
        // Lazy-load OpenAI provider to avoid importing SDK if not used
        const { OpenAiTtsProvider } = await import("./openai.js");
        return new OpenAiTtsProvider();
      }

      case "noop":
      default:
        if (provider !== "noop") {
          console.warn(
            `[TTS] Unknown provider "${provider}", falling back to noop`
          );
        }
        const { NoopTtsProvider } = await import("./noop.js");
        return new NoopTtsProvider();
    }
  })();

  return providerPromise;
}
