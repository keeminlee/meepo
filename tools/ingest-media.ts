/**
 * Sprint -1: Offline Media Ingestion Tool
 * 
 * Takes a video/audio recording and creates a test ledger DB for Phase 1 development.
 * 
 * Usage:
 *   tsx tools/ingest-media.ts --mediaPath <path> --outDb <path> --sessionLabel <label> [options]
 * 
 * Options:
 *   --chunkSec <n>        Chunk length seconds (default 60)
 *   --maxMinutes <n>      Only ingest first N minutes (default: all)
 *   --guildId <id>        Default offline_test
 *   --channelId <id>      Default = sessionLabel
 *   --overwrite           Allow overwriting outDb if it exists
 *   --outDir <path>       Default ./out (writes segments.jsonl)
 *   --help
 * 
 * Example:
 *   tsx tools/ingest-media.ts --mediaPath "D:\Recordings\C2E03.mp4" --outDb ".\data\test_ingest.sqlite" --sessionLabel C2E03 --chunkSec 60 --maxMinutes 20 --overwrite
 */

// Load .env file FIRST (before any other imports that might use env vars)
import dotenv from "dotenv";
dotenv.config();

import { existsSync, mkdirSync, unlinkSync, writeFileSync, appendFileSync } from "node:fs";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { log } from "../src/utils/logger.js";
import { getSttProvider } from "../src/voice/stt/provider.js";
import { normalizeText } from "../src/registry/normalizeText.js";

const execAsync = promisify(exec);
const ingestLog = log.withScope("ingest");

// ============================================================================
// CLI Argument Parsing
// ============================================================================

interface CliArgs {
  mediaPath: string;
  outDb: string;
  sessionLabel: string;
  chunkSec: number;
  maxMinutes?: number;
  guildId: string;
  channelId: string;
  overwrite: boolean;
  outDir: string;
  help: boolean;
}

function printHelp(): void {
  console.log(`
Sprint -1: Offline Media Ingestion Tool

Usage:
  tsx tools/ingest-media.ts --mediaPath <path> --outDb <path> --sessionLabel <label> [options]

Options:
  --mediaPath <path>    Path to video/audio file (mp4/mkv/mp3/wav)
  --outDb <path>        Output SQLite database path
  --sessionLabel <str>  Session identifier (e.g., C2E03)
  --chunkSec <n>        Chunk length in seconds (default: 60)
  --maxMinutes <n>      Only ingest first N minutes (default: all)
  --guildId <id>        Guild ID for ledger entries (default: offline_test)
  --channelId <id>      Channel ID for ledger entries (default: sessionLabel)
  --overwrite           Allow overwriting outDb if it exists
  --outDir <path>       Output directory for segments.jsonl (default: ./out)
  --help                Show this help

Example:
  tsx tools/ingest-media.ts \\
    --mediaPath "D:\\Recordings\\C2E03.mp4" \\
    --outDb ".\\data\\test_ingest.sqlite" \\
    --sessionLabel C2E03 \\
    --chunkSec 60 \\
    --maxMinutes 20 \\
    --overwrite
`);
}

function parseArgs(): CliArgs {
  const args: Partial<CliArgs> = {
    chunkSec: 60,
    guildId: "offline_test",
    overwrite: false,
    outDir: "./out",
    help: false,
  };

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];

    if (arg === "--help") {
      args.help = true;
      continue;
    }

    if (arg === "--overwrite") {
      args.overwrite = true;
      continue;
    }

    // Handle --flag=value
    if (arg.includes("=")) {
      const [key, value] = arg.split("=", 2);
      const flag = key.replace(/^--/, "");
      assignFlag(args, flag, value);
      continue;
    }

    // Handle --flag value
    if (arg.startsWith("--")) {
      const flag = arg.replace(/^--/, "");
      const value = process.argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for flag: ${arg}`);
      }
      assignFlag(args, flag, value);
      i++; // Skip next arg (consumed as value)
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args as CliArgs;
}

function assignFlag(args: Partial<CliArgs>, flag: string, value: string): void {
  switch (flag) {
    case "mediaPath":
      args.mediaPath = value;
      break;
    case "outDb":
      args.outDb = value;
      break;
    case "sessionLabel":
      args.sessionLabel = value;
      break;
    case "chunkSec":
      args.chunkSec = parseInt(value, 10);
      if (isNaN(args.chunkSec) || args.chunkSec <= 0) {
        throw new Error(`Invalid chunkSec: ${value}`);
      }
      break;
    case "maxMinutes":
      args.maxMinutes = parseInt(value, 10);
      if (isNaN(args.maxMinutes) || args.maxMinutes <= 0) {
        throw new Error(`Invalid maxMinutes: ${value}`);
      }
      break;
    case "guildId":
      args.guildId = value;
      break;
    case "channelId":
      args.channelId = value;
      break;
    case "outDir":
      args.outDir = value;
      break;
    default:
      throw new Error(`Unknown flag: --${flag}`);
  }
}

function validateArgs(args: CliArgs): void {
  if (!args.mediaPath) {
    throw new Error("Missing required flag: --mediaPath");
  }
  if (!args.outDb) {
    throw new Error("Missing required flag: --outDb");
  }
  if (!args.sessionLabel) {
    throw new Error("Missing required flag: --sessionLabel");
  }

  // Default channelId to sessionLabel if not provided
  if (!args.channelId) {
    args.channelId = args.sessionLabel;
  }

  // Check media file exists
  if (!existsSync(args.mediaPath)) {
    throw new Error(`Media file not found: ${args.mediaPath}`);
  }

  // Check outDb doesn't exist unless --overwrite
  if (existsSync(args.outDb) && !args.overwrite) {
    throw new Error(
      `Output database already exists: ${args.outDb}\nUse --overwrite to allow overwriting.`
    );
  }
}

// ============================================================================
// FFmpeg Detection
// ============================================================================

async function checkFFmpeg(): Promise<void> {
  try {
    await execAsync("ffmpeg -version");
  } catch (err) {
    throw new Error(
      `FFmpeg not found. Please install FFmpeg and ensure it's in your PATH.\n` +
      `Windows: choco install ffmpeg\n` +
      `macOS: brew install ffmpeg\n` +
      `Linux: apt install ffmpeg`
    );
  }
}

// ============================================================================
// Audio Extraction
// ============================================================================

async function extractAudio(
  mediaPath: string,
  outWavPath: string
): Promise<void> {
  ingestLog.info(`Extracting audio from ${mediaPath}...`);

  // FFmpeg: extract 16kHz mono WAV
  const cmd = `ffmpeg -i "${mediaPath}" -ar 16000 -ac 1 -y "${outWavPath}"`;

  try {
    await execAsync(cmd);
    ingestLog.info(`Audio extracted to ${outWavPath}`);
  } catch (err: any) {
    throw new Error(`FFmpeg failed: ${err.message}`);
  }
}

// ============================================================================
// Audio Chunking
// ============================================================================

interface AudioChunk {
  index: number;
  startSec: number;
  endSec: number;
  pcmPath: string; // Raw PCM file (16kHz mono, 16-bit LE)
}

async function chunkAudio(
  wavPath: string,
  chunkSec: number,
  outDir: string,
  maxMinutes?: number
): Promise<AudioChunk[]> {
  // Get audio duration
  const durationCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${wavPath}"`;
  const { stdout } = await execAsync(durationCmd);
  const totalDurationSec = parseFloat(stdout.trim());

  if (isNaN(totalDurationSec) || totalDurationSec <= 0) {
    throw new Error(`Could not determine audio duration: ${wavPath}`);
  }

  // Calculate effective duration
  let effectiveDurationSec = totalDurationSec;
  if (maxMinutes) {
    effectiveDurationSec = Math.min(totalDurationSec, maxMinutes * 60);
    ingestLog.info(
      `Limiting to first ${maxMinutes} minutes (${effectiveDurationSec}s of ${totalDurationSec}s)`
    );
  }

  // Calculate chunks
  const numChunks = Math.ceil(effectiveDurationSec / chunkSec);
  ingestLog.info(
    `Chunking ${effectiveDurationSec}s into ${numChunks} chunks of ${chunkSec}s`
  );

  const chunks: AudioChunk[] = [];
  const chunksDir = join(outDir, "chunks");
  mkdirSync(chunksDir, { recursive: true });

  for (let i = 0; i < numChunks; i++) {
    const startSec = i * chunkSec;
    const endSec = Math.min((i + 1) * chunkSec, effectiveDurationSec);
    const chunkPcmPath = join(chunksDir, `chunk_${String(i).padStart(4, "0")}.pcm`);

    // Extract chunk as raw PCM (16kHz mono, 16-bit LE) for STT provider
    const extractCmd = `ffmpeg -i "${wavPath}" -ss ${startSec} -t ${endSec - startSec} -ar 16000 -ac 1 -f s16le -acodec pcm_s16le -y "${chunkPcmPath}"`;
    await execAsync(extractCmd);

    chunks.push({
      index: i,
      startSec,
      endSec,
      pcmPath: chunkPcmPath,
    });

    ingestLog.debug(`Chunk ${i + 1}/${numChunks}: ${startSec}s - ${endSec}s`);
  }

  return chunks;
}

// ============================================================================
// Transcription
// ============================================================================

interface TranscriptResult {
  chunk: AudioChunk;
  transcript: string;
  confidence?: number;
  error?: string;
}

async function transcribeChunks(
  chunks: AudioChunk[]
): Promise<TranscriptResult[]> {
  const sttProvider = await getSttProvider();
  const results: TranscriptResult[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    ingestLog.info(
      `Transcribing chunk ${i + 1}/${chunks.length} (${chunk.startSec}s - ${chunk.endSec}s)...`
    );

    try {
      // Read raw PCM file
      const fs = await import("node:fs/promises");
      const pcmBuffer = await fs.readFile(chunk.pcmPath);

      ingestLog.debug(`Chunk ${i + 1}: PCM bytes=${pcmBuffer.length}`);

      // Transcribe via STT provider (expects PCM buffer + sample rate)
      const sttResult = await sttProvider.transcribePcm(pcmBuffer, 16000);

      ingestLog.debug(
        `Chunk ${i + 1}: STT returned, text_len=${sttResult.text?.length ?? 0}, confidence=${sttResult.confidence ?? "N/A"}`
      );

      if (!sttResult.text || sttResult.text.trim() === "") {
        ingestLog.debug(`Chunk ${i + 1}: empty transcript (silence or no speech)`);
        results.push({
          chunk,
          transcript: "",
          confidence: sttResult.confidence,
        });
        continue;
      }

      const preview = sttResult.text.substring(0, 80);
      ingestLog.info(
        `Chunk ${i + 1}: "${preview}${sttResult.text.length > 80 ? "..." : ""}"${sttResult.confidence ? ` (confidence: ${sttResult.confidence.toFixed(2)})` : ""}`
      );

      results.push({
        chunk,
        transcript: sttResult.text,
        confidence: sttResult.confidence,
      });
    } catch (err: any) {
      ingestLog.warn(
        `Chunk ${i + 1} transcription failed: ${err.message ?? err}`
      );
      results.push({
        chunk,
        transcript: "",
        error: err.message ?? String(err),
      });
    }
  }

  return results;
}

// ============================================================================
// Database Writing
// ============================================================================

function initializeDb(dbPath: string): Database.Database {
  // Remove existing DB if overwrite
  if (existsSync(dbPath)) {
    unlinkSync(dbPath);
    ingestLog.info(`Removed existing database: ${dbPath}`);
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  // Create schema (same as bot schema)
  const schema = `
    CREATE TABLE IF NOT EXISTS npc_instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      persona_seed TEXT,
      form_id TEXT NOT NULL DEFAULT 'meepo',
      created_at_ms INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ledger_entries (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      timestamp_ms INTEGER NOT NULL,
      content TEXT NOT NULL,
      content_norm TEXT,
      session_id TEXT,
      tags TEXT NOT NULL DEFAULT 'human',
      source TEXT NOT NULL DEFAULT 'text',
      narrative_weight TEXT NOT NULL DEFAULT 'secondary',
      speaker_id TEXT,
      audio_chunk_path TEXT,
      t_start_ms INTEGER,
      t_end_ms INTEGER,
      confidence REAL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_text_message_unique 
      ON ledger_entries(message_id) 
      WHERE source = 'text';

    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      label TEXT,
      created_at_ms INTEGER,
      started_at_ms INTEGER NOT NULL,
      ended_at_ms INTEGER,
      started_by_id TEXT NOT NULL,
      started_by_name TEXT NOT NULL,
      source TEXT DEFAULT 'live'
    );

    CREATE TABLE IF NOT EXISTS latches (
      key TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      expires_at_ms INTEGER NOT NULL
    );
  `;

  db.exec(schema);
  ingestLog.info(`Initialized database: ${dbPath}`);

  return db;
}

function writeLedgerEntries(
  db: Database.Database,
  results: TranscriptResult[],
  args: CliArgs,
  sessionId: string
): void {
  ingestLog.info("Normalizing transcripts with registry...");
  
  const insertStmt = db.prepare(`
    INSERT INTO ledger_entries (
      id, guild_id, channel_id, message_id, author_id, author_name,
      timestamp_ms, content, content_norm, session_id, tags, source, narrative_weight,
      speaker_id, t_start_ms, t_end_ms, confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const baseTimestamp = Date.now();

  db.transaction(() => {
    for (const result of results) {
      if (!result.transcript) continue; // Skip empty transcripts

      const messageId = `offline_${args.sessionLabel}_chunk_${String(result.chunk.index).padStart(4, "0")}`;
      const timestampMs = baseTimestamp + Math.floor(result.chunk.startSec * 1000);
      const tStartMs = Math.floor(result.chunk.startSec * 1000);
      const tEndMs = Math.floor(result.chunk.endSec * 1000);

      // Normalize transcript (Phase 1C)
      const contentNorm = normalizeText(result.transcript);

      insertStmt.run(
        randomUUID(),        // id (generate UUID)
        args.guildId,        // guild_id
        args.channelId,      // channel_id
        messageId,           // message_id
        "offline_audio",     // author_id
        "Offline Audio",     // author_name
        timestampMs,         // timestamp_ms
        result.transcript,   // content (raw STT)
        contentNorm,         // content_norm (normalized)
        sessionId,           // session_id (UUID invariant)
        "human",             // tags
        "offline_ingest",    // source
        "primary",           // narrative_weight
        "offline_audio",     // speaker_id
        tStartMs,            // t_start_ms
        tEndMs,              // t_end_ms
        result.confidence ?? null // confidence
      );
    }
  })();

  const count = results.filter((r) => r.transcript).length;
  ingestLog.info(`Wrote ${count} ledger entries to database`);
}

function createSessionRecord(
  db: Database.Database,
  results: TranscriptResult[],
  args: CliArgs
): string {
  const firstChunk = results[0]?.chunk;
  const lastChunk = results[results.length - 1]?.chunk;

  if (!firstChunk || !lastChunk) {
    ingestLog.warn("No chunks to create session record");
    return "";
  }

  const baseTimestamp = Date.now();
  const startedAtMs = baseTimestamp + Math.floor(firstChunk.startSec * 1000);
  const endedAtMs = baseTimestamp + Math.floor(lastChunk.endSec * 1000);

  // Generate UUID as the true session_id invariant.
  // session_id is per ingest/run (unique, immutable).
  // sessionLabel is just a grouping label (can repeat across runs, e.g., "C2E01" ingested twice).
  const sessionId = randomUUID();

  const insertStmt = db.prepare(`
    INSERT INTO sessions (session_id, guild_id, label, created_at_ms, started_at_ms, ended_at_ms, started_by_id, started_by_name, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertStmt.run(
    sessionId,            // session_id (UUID - the invariant)
    args.guildId,         // guild_id
    args.sessionLabel,    // label (user metadata, not the PK)
    baseTimestamp,        // created_at_ms (when session record is created)
    startedAtMs,          // started_at_ms (start of content)
    endedAtMs,            // ended_at_ms
    "ingest_script",      // started_by_id
    "Offline Ingest",     // started_by_name
    "ingest-media"        // source
  );

  ingestLog.info(`Created session record: ${args.sessionLabel} (${sessionId})`);
  return sessionId;
}

// ============================================================================
// JSONL Output
// ============================================================================

function writeSegmentsJsonl(
  results: TranscriptResult[],
  outDir: string,
  sessionLabel: string
): void {
  mkdirSync(outDir, { recursive: true });
  const jsonlPath = join(outDir, `segments_${sessionLabel}.jsonl`);

  // Clear file if it exists
  if (existsSync(jsonlPath)) {
    unlinkSync(jsonlPath);
  }

  for (const result of results) {
    const messageId = `offline_${sessionLabel}_chunk_${String(result.chunk.index).padStart(4, "0")}`;

    const line = JSON.stringify({
      chunk_index: result.chunk.index,
      start_sec: result.chunk.startSec,
      end_sec: result.chunk.endSec,
      message_id: messageId,
      transcript: result.transcript,
      confidence: result.confidence ?? null,
      error: result.error ?? null,
    });

    appendFileSync(jsonlPath, line + "\n");
  }

  ingestLog.info(`Wrote segments to ${jsonlPath}`);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  try {
    const args = parseArgs();

    if (args.help) {
      printHelp();
      process.exit(0);
    }

    validateArgs(args);

    ingestLog.info(`Starting ingestion pipeline for ${args.sessionLabel}`);
    ingestLog.info(`Media: ${args.mediaPath}`);
    ingestLog.info(`Output DB: ${args.outDb}`);

    // Step 1: Check FFmpeg
    await checkFFmpeg();

    // Step 2: Extract audio to temp WAV
    const tempDir = join(args.outDir, "temp");
    mkdirSync(tempDir, { recursive: true });
    const wavPath = join(tempDir, `audio_${args.sessionLabel}.wav`);
    await extractAudio(args.mediaPath, wavPath);

    // Step 3: Chunk audio
    const chunks = await chunkAudio(
      wavPath,
      args.chunkSec,
      args.outDir,
      args.maxMinutes
    );

    // Step 4: Transcribe chunks
    const results = await transcribeChunks(chunks);

    // Step 5: Initialize database
    const db = initializeDb(args.outDb);

    // Step 6: Create session record (generates session_id UUID)
    const sessionId = createSessionRecord(db, results, args);

    // Step 7: Write ledger entries (with session_id)
    writeLedgerEntries(db, results, args, sessionId);

    // Step 8: Write segments JSONL
    writeSegmentsJsonl(results, args.outDir, args.sessionLabel);

    // Cleanup
    db.close();

    const totalMinutes = (
      results[results.length - 1]?.chunk.endSec ?? 0
    ) / 60;
    const transcriptCount = results.filter((r) => r.transcript).length;

    ingestLog.info(
      `✅ Ingestion complete: ${transcriptCount}/${chunks.length} chunks transcribed (${totalMinutes.toFixed(1)} minutes)`
    );
    ingestLog.info(`Database: ${args.outDb}`);
    ingestLog.info(`Segments: ${join(args.outDir, `segments_${args.sessionLabel}.jsonl`)}`);
  } catch (err: any) {
    ingestLog.error(`Ingestion failed: ${err.message ?? err}`);
    if (err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

main();
