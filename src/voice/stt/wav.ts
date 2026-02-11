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
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const byteRate = sampleRate * channels * bytesPerSample;
  const blockAlign = channels * bytesPerSample;
  const subChunk2Size = pcm.length; // Data size

  // Total file size (everything after the 8-byte RIFF header)
  const fileSize = 36 + subChunk2Size;

  // Allocate buffer for full WAV file
  const wav = Buffer.alloc(44 + pcm.length);

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

  // Copy PCM data
  pcm.copy(wav, offset);

  return wav;
}
