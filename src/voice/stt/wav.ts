/**
 * WAV encoder for PCM audio (Task 3.3)
 *
 * Wraps raw 16-bit PCM data in a minimal RIFF/WAVE container
 * compatible with OpenAI's Audio API.
 */

/**
 * Convert raw PCM (16-bit little-endian) to WAV format.
 * @param pcm Raw PCM buffer (16-bit samples)
 * @param sampleRate Sample rate in Hz (e.g., 48000)
 * @param channels Number of channels (default 1 for mono)
 * @returns WAV-wrapped buffer
 */
export function pcmToWav(
  pcm: Buffer,
  sampleRate: number,
  channels: number = 1
): Buffer {
  // **FIX 1: Align PCM to sample boundaries (2 bytes for 16-bit mono, 4 for stereo)**
  const bytesPerFrame = channels * 2; // 2 bytes per sample × channels
  let alignedPcmLength = pcm.length - (pcm.length % bytesPerFrame);
  
  // If length became 0 or negative, return minimal WAV
  if (alignedPcmLength <= 0) {
    alignedPcmLength = 0;
  }

  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const byteRate = sampleRate * channels * bytesPerSample;
  const blockAlign = channels * bytesPerSample;
  const subChunk2Size = alignedPcmLength;

  // Total file size (everything after the 8-byte RIFF header)
  const fileSize = 36 + subChunk2Size;

  // Allocate buffer for full WAV file
  const wav = Buffer.alloc(44 + alignedPcmLength);

  // Write RIFF header
  let offset = 0;
  wav.write("RIFF", offset);
  offset += 4;
  wav.writeUInt32LE(fileSize, offset);
  offset += 4;
  wav.write("WAVE", offset);
  offset += 4;

  // Write fmt sub-chunk
  wav.write("fmt ", offset);
  offset += 4;
  wav.writeUInt32LE(16, offset); // SubChunk1Size (16 for PCM)
  offset += 4;
  wav.writeUInt16LE(1, offset); // AudioFormat (1 = PCM)
  offset += 2;
  wav.writeUInt16LE(channels, offset); // NumChannels
  offset += 2;
  wav.writeUInt32LE(sampleRate, offset); // SampleRate
  offset += 4;
  wav.writeUInt32LE(byteRate, offset); // ByteRate
  offset += 4;
  wav.writeUInt16LE(blockAlign, offset); // BlockAlign
  offset += 2;
  wav.writeUInt16LE(bitsPerSample, offset); // BitsPerSample
  offset += 2;

  // Write data sub-chunk
  wav.write("data", offset);
  offset += 4;
  wav.writeUInt32LE(subChunk2Size, offset); // SubChunk2Size
  offset += 4;

  // **FIX 2: Clamp offset and length to buffer boundaries**
  const startOffset = Math.max(0, Math.min(offset, wav.length));
  const copyLength = Math.max(0, Math.min(alignedPcmLength, wav.length - startOffset));

  // Copy PCM data (only aligned portion)
  if (copyLength > 0) {
    pcm.copy(wav, startOffset, 0, copyLength);
  }

  return wav;
}
