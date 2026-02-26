/**
 * STT Provider Interface (Phase 2 Task 3)
 * 
 * Pluggable interface for speech-to-text transcription.
 * Keeps the receiver decoupled from specific STT vendors.
 */

import { NoopSttProvider } from "./noop.js";
import { DebugSttProvider } from "./debug.js";
import { cfg } from "../../config/env.js";

export interface SttProvider {
  /**
   * Transcribe PCM audio to text.
   * @param pcm Raw PCM audio buffer
   * @param sampleRate Sample rate (typically 48000 for Discord)
   * @returns Transcription result with optional confidence score
   */
  transcribePcm(
    pcm: Buffer,
    sampleRate: number
  ): Promise<{
    text: string;
    confidence?: number;
  }>;
}

/**
 * Get provider info for user-facing messages.
 */
export function getSttProviderInfo(): { name: string; description: string } {
  const provider = cfg.stt.provider;
  
  switch (provider) {
    case "noop":
      return { name: "noop", description: "discards transcripts (silent mode)" };
    case "debug":
      return { name: "debug", description: "emits test transcripts for development" };
    case "openai": {
      const model = cfg.stt.model;
      return {
        name: "openai",
        description: `real transcripts via OpenAI Audio API (${model})`,
      };
    }
    default:
      return { name: provider, description: "unknown provider (using noop)" };
  }
}

/**
 * Get the configured STT provider based on environment.
 * STT_PROVIDER env var: "noop" | "debug" | "openai"
 *
 * Providers are lazy-loaded and cached (single instance per bot lifetime).
 */

let providerPromise: Promise<SttProvider> | null = null;

export async function getSttProvider(): Promise<SttProvider> {
  // Return cached promise if already initialized
  if (providerPromise) return providerPromise;

  const provider = cfg.stt.provider;

  // Create the promise and cache it
  providerPromise = (async () => {
    switch (provider) {
      case "noop":
        return new NoopSttProvider();

      case "debug":
        return new DebugSttProvider();

      case "openai": {
        // Lazy-load OpenAI provider to avoid importing SDK if not used
        const { OpenAiSttProvider } = await import("./openai.js");
        return new OpenAiSttProvider();
      }

      default:
        console.warn(
          `[STT] Unknown provider "${provider}", falling back to noop`
        );
        return new NoopSttProvider();
    }
  })();

  return providerPromise;
}
