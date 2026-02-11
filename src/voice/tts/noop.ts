/**
 * Noop TTS Provider
 *
 * Placeholder: no-op synthesis (disabled).
 */

import { TtsProvider } from "./provider.js";

export class NoopTtsProvider implements TtsProvider {
  async synthesize(text: string): Promise<Buffer> {
    console.warn(`[TTS] Noop provider: ignoring synthesis request for "${text.substring(0, 50)}..."`);
    // Return empty buffer; caller should handle gracefully
    return Buffer.alloc(0);
  }
}
