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
  content_norm: string | null;     // Phase 1C: Normalized content
  session_id: string | null;       // Phase 1: Session this entry belongs to
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
  e: Omit<LedgerEntry, "id" | "tags" | "source" | "narrative_weight" | "speaker_id" | "audio_chunk_path" | "t_start_ms" | "t_end_ms" | "confidence" | "content_norm" | "session_id"> & {
    tags?: string;
    content_norm?: string | null;
    session_id?: string | null;
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
        timestamp_ms, content, content_norm, session_id, tags, source, narrative_weight, speaker_id, 
        audio_chunk_path, t_start_ms, t_end_ms, confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      e.guild_id,
      e.channel_id,
      e.message_id,
      e.author_id,
      e.author_name,
      e.timestamp_ms,
      e.content,
      e.content_norm ?? null,
      e.session_id ?? null,
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
  primaryOnly?: boolean; // Filter to narrative_weight IN ('primary', 'elevated')
}): LedgerEntry[] {
  const db = getDb();
  const endMs = opts.endMs ?? Date.now();
  const limit = opts.limit ?? 500;
  const primaryOnly = opts.primaryOnly ?? false;

  let query = "SELECT * FROM ledger_entries WHERE guild_id = ? AND timestamp_ms >= ? AND timestamp_ms < ?";
  
  if (primaryOnly) {
    query += " AND narrative_weight IN ('primary', 'elevated')";
  }
  
  query += " ORDER BY timestamp_ms ASC, id ASC LIMIT ?";

  const rows = db.prepare(query).all(opts.guildId, opts.startMs, endMs, limit) as LedgerEntry[];

  return rows;
}

export function getLedgerForSession(opts: {
  sessionId: string;
  primaryOnly?: boolean; // Filter to narrative_weight IN ('primary', 'elevated')
}): LedgerEntry[] {
  const db = getDb();
  const primaryOnly = opts.primaryOnly ?? false;

  let query = "SELECT * FROM ledger_entries WHERE session_id = ?";
  
  if (primaryOnly) {
    query += " AND narrative_weight IN ('primary', 'elevated')";
  }
  
  query += " ORDER BY timestamp_ms ASC, id ASC";

  const rows = db.prepare(query).all(opts.sessionId) as LedgerEntry[];

  return rows;
}

/**
 * Task 4.7: Voice-aware context for LLM prompts
 * 
 * Pulls recent ledger entries with voice-first prioritization:
 * - Prefers source='voice' and narrative_weight IN ('primary', 'elevated')
 * - Falls back to recent text if voice context is sparse
 * - Returns formatted string with speaker attribution
 * 
 * Designed for use in buildMeepoPrompt() to make personas aware of spoken conversation.
 */
export function getVoiceAwareContext(opts: {
  guildId: string;
  channelId: string;
  windowMs?: number; // Time window (default: LLM_VOICE_CONTEXT_MS env or 120s)
  limit?: number;    // Max entries to return (default: 20)
}): { context: string; hasVoice: boolean } {
  const db = getDb();
  const now = Date.now();
  const windowMs = opts.windowMs ?? Number(process.env.LLM_VOICE_CONTEXT_MS ?? "120000");
  const limit = opts.limit ?? 20;
  const startMs = now - windowMs;

  // Pull primary/elevated narrative entries within time window
  // Excludes system noise (wake/join/leave already marked secondary)
  const query = `
    SELECT author_name, content, source, timestamp_ms 
    FROM ledger_entries 
    WHERE guild_id = ? 
      AND channel_id = ? 
      AND timestamp_ms >= ? 
      AND narrative_weight IN ('primary', 'elevated')
      AND tags NOT LIKE '%system%'
    ORDER BY timestamp_ms ASC, id ASC
    LIMIT ?
  `;

  const rows = db.prepare(query).all(
    opts.guildId,
    opts.channelId,
    startMs,
    limit
  ) as { author_name: string; content: string; source: string; timestamp_ms: number }[];

  if (rows.length === 0) {
    return { context: "", hasVoice: false };
  }

  // Check if any voice entries exist
  const hasVoice = rows.some((r) => r.source === "voice");

  // Format entries with speaker attribution and source indicator
  const formatted = rows
    .map((r) => {
      const sourceTag = r.source === "voice" ? " (voice)" : "";
      return `${r.author_name}${sourceTag}: ${r.content}`;
    })
    .join("\n");

  return { context: formatted, hasVoice };
}

/**
 * Task 7: Get ledger entries by ID range
 * 
 * Enables targeted re-LLM by returning a slice of entries.
 * Used when regenerating a single Meecap scene without reprocessing the whole session.
 * 
 * @param opts.startId - First ledger entry ID (inclusive)
 * @param opts.endId - Last ledger entry ID (inclusive)
 * @returns Ordered entries from startId to endId
 * 
 * Note: Assumes IDs are stable and belong to same session. Returns empty if not found.
 */
export function getSliceByLedgerIdRange(opts: {
  startId: string;
  endId: string;
}): LedgerEntry[] {
  const db = getDb();
  const { startId, endId } = opts;

  // First pass: find the position of start and end entries
  const startEntry = db.prepare("SELECT id, timestamp_ms FROM ledger_entries WHERE id = ?").get(startId) as { id: string; timestamp_ms: number } | undefined;
  const endEntry = db.prepare("SELECT id, timestamp_ms FROM ledger_entries WHERE id = ?").get(endId) as { id: string; timestamp_ms: number } | undefined;

  if (!startEntry || !endEntry) {
    return [];
  }

  // Get all entries in the time window (inclusive on both ends)
  const rows = db
    .prepare(
      "SELECT * FROM ledger_entries WHERE timestamp_ms >= ? AND timestamp_ms <= ? ORDER BY timestamp_ms ASC, id ASC"
    )
    .all(startEntry.timestamp_ms, endEntry.timestamp_ms) as LedgerEntry[];

  return rows;
}

