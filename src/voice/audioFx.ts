/**
 * Post-TTS Audio Effects Pipeline (FFmpeg)
 * 
 * Optional audio processing layer that applies pitch shift and reverb
 * to TTS output before playback. Provider-agnostic, fully reversible via env flags.
 * 
 * Env vars:
 * - AUDIO_FX_ENABLED=true|false (default: false)
 * - AUDIO_FX_PITCH=1.05 (default: 1.0, no change)
 * - AUDIO_FX_REVERB=true|false (default: false)
 * - AUDIO_FX_REVERB_WET=0.3 (default: 0.3, output gain for wet signal)
 * - AUDIO_FX_REVERB_DELAY_MS=20 (default: 20, small room)
 * - AUDIO_FX_REVERB_DECAY=0.4 (default: 0.4, how much echo fades)
 */

import { spawn } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEBUG_FX = process.env.DEBUG_VOICE === "true";

/**
 * Apply post-TTS audio effects using FFmpeg.
 * 
 * @param input Audio buffer (MP3 or WAV)
 * @param format Input format ("mp3" | "wav")
 * @returns Processed audio buffer or original on failure (never throws)
 */
export async function applyPostTtsFx(
  input: Buffer,
  format: "mp3" | "wav"
): Promise<Buffer> {
  const enabled = (process.env.AUDIO_FX_ENABLED ?? "false").toLowerCase() === "true";

  if (!enabled) {
    if (DEBUG_FX) {
      console.log("[AudioFX] Disabled");
    }
    return input;
  }

  try {
    const pitch = parseFloat(process.env.AUDIO_FX_PITCH ?? "1.0");
    const reverbEnabled = (process.env.AUDIO_FX_REVERB ?? "false").toLowerCase() === "true";
    const reverbWet = parseFloat(process.env.AUDIO_FX_REVERB_WET ?? "0.3");
    const reverbDelay = parseInt(process.env.AUDIO_FX_REVERB_DELAY_MS ?? "20", 10);
    const reverbDecay = parseFloat(process.env.AUDIO_FX_REVERB_DECAY ?? "0.4");

    if (DEBUG_FX || pitch !== 1.0 || reverbEnabled) {
      console.log(
        `[AudioFX] Enabled (pitch=${pitch.toFixed(2)}, reverb=${reverbEnabled})`
      );
    }

    // Build FFmpeg filter chain
    const filters: string[] = [];

    // Pitch shift (no speed change) using rubberband
    if (pitch !== 1.0) {
      filters.push(`rubberband=pitch=${pitch.toFixed(3)}`);
    }

    // Reverb using aecho
    if (reverbEnabled) {
      // aecho format: in_gain:out_gain:delay_ms:decay
      // in_gain: input signal gain (0-1)
      // out_gain: output/wet signal gain (0-1) - controls wet/dry mix
      // delay_ms: echo delay time in milliseconds
      // decay: how much the echo fades (0-1)
      const inGain = 0.8;
      const outGain = reverbWet;
      filters.push(`aecho=${inGain}:${outGain}:${reverbDelay}:${reverbDecay}`);
    }

    // If no filters, return original
    if (filters.length === 0) {
      return input;
    }

    const filterChain = filters.join(",");

    // Create temp files
    const tempId = randomBytes(8).toString("hex");
    const inputPath = join(tmpdir(), `tts_in_${tempId}.${format}`);
    const outputPath = join(tmpdir(), `tts_out_${tempId}.mp3`);

    try {
      // Write input buffer to temp file
      await writeFile(inputPath, input);

      // Run FFmpeg
      const output = await runFfmpeg(inputPath, outputPath, filterChain);

      // Clean up input file
      await unlink(inputPath).catch(() => {});

      return output;
    } catch (err: any) {
      // Clean up temp files on error
      await unlink(inputPath).catch(() => {});
      await unlink(outputPath).catch(() => {});
      throw err;
    }
  } catch (err: any) {
    console.error(`[AudioFX] Failed, falling back to raw TTS: ${err.message ?? err}`);
    return input;
  }
}

/**
 * Execute FFmpeg with audio filter chain.
 */
async function runFfmpeg(
  inputPath: string,
  outputPath: string,
  filterChain: string
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const args = [
      "-i", inputPath,
      "-af", filterChain,
      "-acodec", "libmp3lame",
      "-b:a", "128k",
      "-y", // Overwrite output
      outputPath,
    ];

    const ffmpeg = spawn("ffmpeg", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";

    ffmpeg.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    ffmpeg.on("error", (err) => {
      reject(new Error(`FFmpeg spawn failed: ${err.message}`));
    });

    ffmpeg.on("close", async (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg exited with code ${code}: ${stderr}`));
        return;
      }

      try {
        const { readFile } = await import("node:fs/promises");
        const output = await readFile(outputPath);
        
        // Clean up output file
        await unlink(outputPath).catch(() => {});
        
        resolve(output);
      } catch (err: any) {
        reject(new Error(`Failed to read FFmpeg output: ${err.message}`));
      }
    });
  });
}
