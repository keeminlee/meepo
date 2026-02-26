import type { SttProvider } from "./provider.js";

/**
 * No-Op STT Provider (Phase 2 Task 3)
 * 
 * Returns empty transcriptions - used for:
 * - Testing the full pipeline without real STT
 * - Verifying gating → STT → ledger flow
 * - Avoiding coupling architecture development to Whisper debugging
 */
export class NoopSttProvider implements SttProvider {
  async transcribePcm(pcm: Buffer, sampleRate: number): Promise<{ text: string; confidence?: number; meta?: { noSpeechProb?: number; avgLogprob?: number } }> {
    // Return empty text - receiver will discard these silently
    // This proves the pipeline works without spamming fake transcriptions
    return { text: "" };
  }
}
