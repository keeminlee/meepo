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
  private language?: string;

  constructor() {
    this.model = process.env.STT_OPENAI_MODEL ?? "gpt-4o-mini-transcribe";
    this.language = process.env.STT_LANGUAGE;

    if (process.env.DEBUG_VOICE === "true") {
      console.log(
        `[STT] OpenAI provider initialized: model=${this.model}, language=${this.language ?? "not set"}`
      );
    }
  }

  async transcribePcm(
    pcm: Buffer,
    sampleRate: number
  ): Promise<{ text: string; confidence?: number }> {
    // Task 3.5: Retry once on transient errors (429/5xx/network)
    let lastError: any;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // Convert PCM to WAV (mono, 16-bit)
        const wavBuffer = pcmToWav(pcm, sampleRate, 1);

        // Wrap WAV buffer as proper File object for OpenAI API
        const file = await toFile(wavBuffer, "utterance.wav", { type: "audio/wav" });

        const client = getOpenAIClient();

        // Call OpenAI Audio API
        // Note: prompt is intentionally omitted. Whisper treats it as preceding text,
        // not vocabulary hints. On short/ambiguous audio, it echoes the prompt back.
        const response = await client.audio.transcriptions.create({
          file,
          model: this.model,
          language: this.language,
        });

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
