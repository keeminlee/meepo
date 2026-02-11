/**
 * OpenAI TTS Provider (Task 4.2)
 *
 * Converts text to speech using OpenAI's TTS API (audio.speech endpoint).
 *
 * Audio Format Strategy (Task 4.2):
 * Output: MP3 (default OpenAI format)
 * Rationale: Well-documented, immediately available, compatible with prism-media decoding
 * Decoding to PCM: Handled in Task 4.3 voice speaker pipeline
 *
 * Implementation:
 * - Chunk long text to stay within reasonable per-request limits
 * - Synthesize chunks sequentially (avoid concurrent rate-limit issues)
 * - Concatenate MP3 buffers (or handle in playback queue if separate buffers needed)
 */

import { getOpenAIClient } from "../../llm/client.js";
import { TtsProvider } from "./provider.js";

export class OpenAiTtsProvider implements TtsProvider {
  private model: string;
  private voice: string;
  private maxCharsPerChunk: number;

  constructor() {
    this.model = process.env.TTS_OPENAI_MODEL ?? "gpt-4o-mini-tts";
    this.voice = process.env.TTS_VOICE ?? "alloy";
    this.maxCharsPerChunk = parseInt(
      process.env.TTS_MAX_CHARS_PER_CHUNK ?? "350",
      10
    );

    if (process.env.DEBUG_VOICE === "true") {
      console.log(
        `[TTS] OpenAI provider initialized: model=${this.model}, voice=${this.voice}, maxCharsPerChunk=${this.maxCharsPerChunk}`
      );
    }
  }

  /**
   * Split text into chunks on sentence/word boundaries to avoid cutting mid-word.
   */
  private chunkText(text: string): string[] {
    if (text.length <= this.maxCharsPerChunk) {
      return [text];
    }

    const chunks: string[] = [];
    let current = "";

    // Split on sentences first (. ! ?)
    const sentences = text.split(/(?<=[.!?])\s+/);

    for (const sentence of sentences) {
      if ((current + sentence).length <= this.maxCharsPerChunk) {
        current += (current ? " " : "") + sentence;
      } else {
        if (current) chunks.push(current);
        current = sentence;
      }
    }

    if (current) chunks.push(current);
    return chunks;
  }

  async synthesize(text: string): Promise<Buffer> {
    if (!text || text.trim() === "") {
      return Buffer.alloc(0);
    }

    try {
      const client = getOpenAIClient();
      const chunks = this.chunkText(text.trim());

      if (process.env.DEBUG_VOICE === "true") {
        console.log(
          `[TTS] Synthesizing ${chunks.length} chunk(s), total chars=${text.length}`
        );
      }

      // Synthesize chunks sequentially
      const buffers: Buffer[] = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];

        // Official pattern from OpenAI docs
        const response = await client.audio.speech.create({
          model: this.model,
          voice: this.voice as any, // voice is string union type but cast for safety
          input: chunk,
        });

        const buf = Buffer.from(await response.arrayBuffer());
        buffers.push(buf);

        if (process.env.DEBUG_VOICE === "true" && chunks.length > 1) {
          console.log(
            `[TTS] Chunk ${i + 1}/${chunks.length}: ${chunk.substring(0, 50).replace(/\n/g, " ")}...`
          );
        }
      }

      // Concatenate all MP3 buffers
      const totalBuffer = Buffer.concat(buffers);

      if (process.env.DEBUG_VOICE === "true") {
        console.log(
          `[TTS] Synthesis complete: ${totalBuffer.length} bytes of MP3 audio`
        );
      }

      return totalBuffer;
    } catch (err: any) {
      const message = err.message ?? err.toString();
      console.error(
        `[TTS] OpenAI synthesis failed for text "${text.substring(0, 50).replace(/\n/g, " ")}...": ${message}`
      );
      throw err;
    }
  }
}
