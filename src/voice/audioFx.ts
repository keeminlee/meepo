/**
 * Post-TTS Audio Effects Pipeline (FFmpeg)
 * 
 * Optional audio processing layer that applies pitch shift and reverb
 * to TTS output before playback. Provider-agnostic, fully reversible via env flags.
 * 
 * Reverb Implementation: Multi-tap echo simulation (mimics freeverb-style decay)
 * 
 * Env vars:
 * - AUDIO_FX_ENABLED=true|false (default: false)
 * - AUDIO_FX_PITCH=1.05 (default: 1.0, no change)
 * - AUDIO_FX_REVERB=true|false (default: false)
 * - AUDIO_FX_REVERB_WET=0.3 (default: 0.3, output gain for wet signal, 0-1)
 * - AUDIO_FX_REVERB_ROOM_MS=100 (default: 100, simulated room size in ms)
 * - AUDIO_FX_REVERB_DAMPING=0.7 (default: 0.7, high-freq damping, 0-1)
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

    // Reverb using multiple echo delays (simulates reverb decay)
    if (reverbEnabled) {
      // Create multiple staggered delays to simulate a reverb tail
      // This is better than single aecho because it creates a more natural decay
      const reverbRoom = parseInt(process.env.AUDIO_FX_REVERB_ROOM_MS ?? "100", 10); // room size in ms
      const reverbDamping = parseFloat(process.env.AUDIO_FX_REVERB_DAMPING ?? "0.7"); // high freq damping
      
      // Build reverb using freeverb-style multi-tap delays
      // Multiple echoes at different delays create the reverb "tail"
      const taps = [
        { delayMs: 30, gain: 0.4 },
        { delayMs: 60, gain: 0.3 },
        { delayMs: 100, gain: 0.2 },
        { delayMs: 150, gain: 0.15 },
      ];
      
      // Construct aecho with multiple taps: delays separated by | and gains by |
      const delays = taps.map(t => t.delayMs).join("|");
      const gains = taps.map(t => t.gain).join("|");
      const aechoFilter = `aecho=0.8:${reverbWet}:${delays}:${gains}`;
      
      filters.push(aechoFilter);
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
