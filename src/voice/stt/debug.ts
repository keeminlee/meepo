import type { SttProvider } from "./provider.js";

/**
 * Debug STT Provider (Phase 2 Task 3)
 * 
 * Returns deterministic test transcriptions to prove the full pipeline works.
 * Used for:
 * - Verifying gating → STT → ledger emission
 * - Testing /session transcript --primary shows voice entries
 * - Confirming voice utterances appear in recaps
 * - No API keys required
 */
export class DebugSttProvider implements SttProvider {
  private counter = 0;

  async transcribePcm(pcm: Buffer, sampleRate: number): Promise<{ text: string; confidence?: number; meta?: { noSpeechProb?: number; avgLogprob?: number } }> {
    this.counter++;
    
    // Calculate duration from PCM bytes
    const BYTES_PER_SEC = sampleRate * 2 * 2; // stereo, 16-bit
    const durationSec = pcm.length / BYTES_PER_SEC;
    
    // Return deterministic test text
    const text = `(voice heard ${this.counter}, ${durationSec.toFixed(1)}s)`;
    
    console.log(`[STT:DEBUG] Emitting test transcript: "${text}"`);
    
    return { 
      text,
      confidence: 0.99 // Mock high confidence for debug
    };
  }
}
