import { randomUUID } from "node:crypto";
import { getDb } from "../db.js";

/**
 * Ledger: Omniscient append-only event log (MVP Day 8 - Phase 0)
 * 
 * NARRATIVE AUTHORITY MODEL:
 * - Voice is primary source (reflects D&D at the table)
 * - Text is secondary unless explicitly elevated
 * - Everything is captured, but primacy determines what recaps/NPC Mind consume
 * 
 * Tags distinguish speaker types:
 * - "human" - Messages from human users
 * - "npc,meepo,spoken" - Meepo's speech
 * - "system" - System events, session markers
 * 
 * Source types:
 * - "text" - Discord text messages (default)
 * - "voice" - STT transcriptions (primary narrative)
 * - "system" - Bot-generated events (session markers, state changes)
 * 
 * Narrative weight:
 * - "primary" - Voice transcripts, system events (default for recaps)
 * - "secondary" - Normal text chat (excluded from recaps unless --full flag)
 * - "elevated" - Text explicitly marked important by DM
 * 
 * Privacy & Storage:
 * - Audio chunks NOT saved by default (stream → transcribe → discard)
 * - audio_chunk_path only populated if STT_SAVE_AUDIO=true (debugging only)
 */

export type LedgerEntry = {
  id: string;
  guild_id: string;
  channel_id: string;
  message_id: string;
  author_id: string;
  author_name: string;
  timestamp_ms: number;
  content: string;
  tags: string;
  
  // Voice & Narrative Authority (Phase 0)
  source: "text" | "voice" | "system";
  narrative_weight: "primary" | "secondary" | "elevated";
  speaker_id: string | null;       // Discord user_id for voice
  audio_chunk_path: string | null; // Only if STT_SAVE_AUDIO=true
  t_start_ms: number | null;       // Voice segment start
  t_end_ms: number | null;         // Voice segment end
  confidence: number | null;       // STT confidence (0.0-1.0)
};

export function appendLedgerEntry(
  e: Omit<LedgerEntry, "id" | "tags" | "source" | "narrative_weight" | "speaker_id" | "audio_chunk_path" | "t_start_ms" | "t_end_ms" | "confidence"> & {
    tags?: string;
    source?: "text" | "voice" | "system";
    narrative_weight?: "primary" | "secondary" | "elevated";
    speaker_id?: string | null;
    audio_chunk_path?: string | null;
    t_start_ms?: number | null;
    t_end_ms?: number | null;
    confidence?: number | null;
  }
) {
  const db = getDb();
  const id = randomUUID();
  const tags = e.tags ?? "public";
  const source = e.source ?? "text";
  
  // Default narrative_weight based on source type
  // Voice/system are primary narrative; text is secondary unless elevated
  const narrative_weight = e.narrative_weight ?? 
    (source === "voice" || source === "system" ? "primary" : "secondary");

  try {
    db.prepare(
      `INSERT INTO ledger_entries (
        id, guild_id, channel_id, message_id, author_id, author_name, 
        timestamp_ms, content, tags, source, narrative_weight, speaker_id, 
        audio_chunk_path, t_start_ms, t_end_ms, confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      e.guild_id,
      e.channel_id,
      e.message_id,
      e.author_id,
      e.author_name,
      e.timestamp_ms,
      e.content,
      tags,
      source,
      narrative_weight,
      e.speaker_id ?? null,
      e.audio_chunk_path ?? null,
      e.t_start_ms ?? null,
      e.t_end_ms ?? null,
      e.confidence ?? null
    );
  } catch (err: any) {
    // Silently ignore duplicate message_id for text messages (unique constraint scoped to source='text')
    // Voice/system entries use synthetic UUIDs and won't trigger this
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE" || err.message?.includes("UNIQUE constraint")) {
      return;
    }
    throw err;
  }
}

export function getRecentLedgerText(opts: {
  guildId: string;
  channelId: string;
  limit?: number;
}): string {
  const db = getDb();
  const limit = opts.limit ?? 20;

  // Include text messages only (human and NPC) for conversational coherence
  // Excludes system events and future voice transcripts
  const rows = db.prepare(
    "SELECT author_name, timestamp_ms, content FROM ledger_entries WHERE guild_id = ? AND channel_id = ? AND source = 'text' ORDER BY timestamp_ms DESC LIMIT ?"
  ).all(opts.guildId, opts.channelId, limit) as { author_name: string; timestamp_ms: number; content: string }[];

  // chronological order (oldest -> newest)
  rows.reverse();

  return rows
    .map((r) => {
      const t = new Date(r.timestamp_ms).toISOString();
      return "[" + t + "] " + r.author_name + ": " + r.content;
    })
    .join("\n");
}

export function getLedgerInRange(opts: {
  guildId: string;
  startMs: number;
  endMs?: number;
  limit?: number;
}): LedgerEntry[] {
  const db = getDb();
  const endMs = opts.endMs ?? Date.now();
  const limit = opts.limit ?? 500;

  const rows = db.prepare(
    "SELECT * FROM ledger_entries WHERE guild_id = ? AND timestamp_ms >= ? AND timestamp_ms < ? ORDER BY timestamp_ms ASC LIMIT ?"
  ).all(opts.guildId, opts.startMs, endMs, limit) as LedgerEntry[];

  return rows;
}
