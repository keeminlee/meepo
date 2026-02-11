/**
 * OpenAI TTS Provider (Task 4.2)
 *
 * Converts text to speech using OpenAI's TTS API.
 *
 * Audio Format Strategy:
 *
 * Option A (Preferred): Request WAV/PCM 48kHz mono output
 *   - Best case: OpenAI API supports response_format parameter
 *   - Direct: text → WAV/PCM → Discord voice
 *   - Check OpenAI docs: client.audio.speech.create({ ... response_format: "wav" })
 *
 * Option B (Fallback): Accept default MP3, decode via prism-media
 *   - If Option A unavailable: text → MP3 → prism-media decoder → PCM → Discord
 *   - Still compatible with Discord voice pipeline
 *   - Adds one encoding step but minimal complexity
 *
 * Implementation notes:
 * - Chunk text before synthesis to avoid tokens-per-request limits
 * - Use TTS_MAX_CHARS_PER_CHUNK (default 350) to split long responses
 * - All chunks synthesized sequentially, then queued for playback
 */

import { getOpenAIClient } from "../../llm/client.js";
import { TtsProvider } from "./provider.js";

export class OpenAiTtsProvider implements TtsProvider {
  private model: string;
  private voice: string;

  constructor() {
    this.model = process.env.TTS_OPENAI_MODEL ?? "gpt-4o-mini-tts";
    this.voice = process.env.TTS_VOICE ?? "alloy";

    if (process.env.DEBUG_VOICE === "true") {
      console.log(
        `[TTS] OpenAI provider initialized: model=${this.model}, voice=${this.voice}`
      );
    }
  }

  async synthesize(text: string): Promise<Buffer> {
    // TODO: Implement Task 4.2
    // 1. Determine audio format strategy (WAV vs MP3)
    // 2. Call OpenAI API
    // 3. Return audio buffer
    throw new Error("[TTS] OpenAI provider not yet implemented (Task 4.2)");
  }
}
