/**
 * OpenAI Whisper STT Provider (Task 3.1)
 *
 * Integrates OpenAI's Audio → transcriptions endpoint.
 * Reuses the same OpenAI singleton from llm/client.ts.
 * 
 * Includes retry logic (Task 3.5) for transient errors.
 */

import { getOpenAIClient } from "../../llm/client.js";
import { SttProvider } from "./provider.js";
import { pcmToWav } from "./wav.js";
import { toFile } from "openai/uploads";

/**
 * Check if an error is retryable (429/5xx/network).
 */
function isRetryableError(err: any): boolean {
  const status = err.status ?? 0;
  // Retry on: 429 (rate limit), 5xx (server error), or network errors
  return (
    status === 429 ||
    (status >= 500 && status < 600) ||
    err.code === "ECONNRESET" ||
    err.code === "ETIMEDOUT"
  );
}

/**
 * Delay with jitter (ms).
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class OpenAiSttProvider implements SttProvider {
  private model: string;
  private language: string;
  private prompt?: string;

  constructor() {
    this.model = process.env.STT_OPENAI_MODEL ?? "gpt-4o-mini-transcribe";
    this.language = process.env.STT_LANGUAGE ?? "en";
    this.prompt = process.env.STT_PROMPT;

    if (process.env.DEBUG_VOICE === "true") {
      console.log(
        `[STT] OpenAI provider initialized: model=${this.model}, language=${this.language}${this.prompt ? ", prompt enabled" : ""}`
      );
    }
  }

  /**
   * Downmix stereo PCM to mono by averaging L and R channels.
   * Improves STT clarity on speech models.
   * Handles alignment: ensures output is aligned to sample boundaries.
   */
  private downmixToMono(pcm: Buffer, originalChannels: number): Buffer {
    if (originalChannels === 1) return pcm;

    // Assuming 16-bit samples (2 bytes per sample)
    const bytesPerFrame = originalChannels * 2;
    
    // **FIX: Clamp to aligned length (must be multiple of bytesPerFrame)**
    const alignedBytes = pcm.length - (pcm.length % bytesPerFrame);
    
    if (alignedBytes <= 0) {
      // Not enough data for even one frame, return empty mono buffer
      return Buffer.alloc(0);
    }

    const samples = alignedBytes / 2; // Total 16-bit samples
    const monoBuffer = Buffer.alloc((samples / originalChannels) * 2);

    for (let i = 0; i < samples; i += originalChannels) {
      let sum = 0;
      for (let ch = 0; ch < originalChannels; ch++) {
        const idx = (i + ch) * 2;
        // **FIX: Clamp index to buffer bounds before reading**
        if (idx + 1 < pcm.length) {
          sum += pcm.readInt16LE(idx);
        }
      }
      const avg = Math.round(sum / originalChannels);
      const outIdx = (i / originalChannels) * 2;
      if (outIdx + 1 <= monoBuffer.length) {
        monoBuffer.writeInt16LE(Math.max(-32768, Math.min(32767, avg)), outIdx);
      }
    }

    return monoBuffer;
  }

  async transcribePcm(
    pcm: Buffer,
    sampleRate: number
  ): Promise<{ text: string; confidence?: number }> {
    // Task 3.5: Retry once on transient errors (429/5xx/network)
    let lastError: any;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // Downmix stereo to mono for better STT clarity
        // Discord sends stereo, but speech models are often clearer with mono
        const monoPcm = this.downmixToMono(pcm, 2);

        // Convert PCM to WAV (mono, 16-bit)
        const wavBuffer = pcmToWav(monoPcm, sampleRate, 1);

        // Wrap WAV buffer as proper File object for OpenAI API
        const file = await toFile(wavBuffer, "utterance.wav", { type: "audio/wav" });

        const client = getOpenAIClient();

        // Build transcription request with language + vocab hints
        const transcribeRequest: any = {
          file,
          model: this.model,
          language: this.language,
        };

        // Add prompt if configured (guides vocabulary/style)
        if (this.prompt) {
          transcribeRequest.prompt = this.prompt;
        }

        const response = await client.audio.transcriptions.create(transcribeRequest);

        // Extract and clean text
        const text = response.text?.trim() ?? "";

        return {
          text,
          // OpenAI transcription API doesn't return confidence scores
          confidence: undefined,
        };
      } catch (err: any) {
        lastError = err;
        const message = err.message ?? err.toString();
        const status = err.status ?? "unknown";

        if (!isRetryableError(err) || attempt === 1) {
          // Non-retryable error or second attempt failed; log and re-throw
          console.error(
            `[STT] OpenAI transcription failed (attempt ${attempt + 1}, ${status}): ${message}`
          );
          throw err;
        }

        // Transient error on first attempt; retry after backoff
        const backoffMs = 250 + Math.random() * 250; // 250-500ms jitter
        console.warn(
          `[STT] Transient error (${status}), retrying in ${backoffMs.toFixed(0)}ms: ${message}`
        );
        await sleep(backoffMs);
      }
    }

    // Shouldn't reach here, but just in case
    throw (
      lastError ?? new Error("[STT] Unknown transcription error")
    );
  }
}
