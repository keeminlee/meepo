import { randomUUID } from "node:crypto";
import { getDb } from "../db.js";

/**
 * Ledger: Omniscient append-only event log
 * 
 * Tags distinguish speaker types and sources:
 * - "human" - Messages from human users
 * - "npc,meepo,spoken" - Meepo's speech (included in recaps & context for coherence)
 * - "system" - (future) System events
 * 
 * Important: Meepo's replies ARE part of the world history and must be logged.
 * Context building includes them for conversational coherence, but NPC Mind (future)
 * will not treat Meepo's own speech as authoritative evidence.
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
};

export function appendLedgerEntry(e: Omit<LedgerEntry, "id" | "tags"> & { tags?: string }) {
  const db = getDb();
  const id = randomUUID();
  const tags = e.tags ?? "public";

  try {
    db.prepare(
      "INSERT INTO ledger_entries (id, guild_id, channel_id, message_id, author_id, author_name, timestamp_ms, content, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      id,
      e.guild_id,
      e.channel_id,
      e.message_id,
      e.author_id,
      e.author_name,
      e.timestamp_ms,
      e.content,
      tags
    );
  } catch (err: any) {
    // Silently ignore duplicate message_id (unique constraint violation)
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

  // Include all messages (human and NPC) for conversational coherence
  const rows = db.prepare(
    "SELECT author_name, timestamp_ms, content FROM ledger_entries WHERE guild_id = ? AND channel_id = ? ORDER BY timestamp_ms DESC LIMIT ?"
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
