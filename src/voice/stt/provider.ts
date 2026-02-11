/**
 * STT Provider Interface (Phase 2 Task 3)
 * 
 * Pluggable interface for speech-to-text transcription.
 * Keeps the receiver decoupled from specific STT vendors.
 */

import { NoopSttProvider } from "./noop.js";
import { DebugSttProvider } from "./debug.js";

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
  const provider = process.env.STT_PROVIDER ?? "noop";
  
  switch (provider) {
    case "noop":
      return { name: "noop", description: "discards transcripts (silent mode)" };
    case "debug":
      return { name: "debug", description: "emits test transcripts for development" };
    case "openai":
      return { name: "openai", description: "emits real transcripts via Whisper API" };
    default:
      return { name: provider, description: "unknown provider (using noop)" };
  }
}

/**
 * Get the configured STT provider based on environment.
 * STT_PROVIDER env var: "noop" | "debug" | "openai" | "local"
 */
export function getSttProvider(): SttProvider {
  const provider = process.env.STT_PROVIDER ?? "noop";
  
  switch (provider) {
    case "noop":
      return new NoopSttProvider();
    
    case "debug":
      return new DebugSttProvider();
    
    // TODO Phase 3: Add OpenAI Whisper provider
    // case "openai":
    //   return new OpenAiSttProvider();
    
    default:
      console.warn(`[STT] Unknown provider "${provider}", falling back to noop`);
      return new NoopSttProvider();
  }
}
