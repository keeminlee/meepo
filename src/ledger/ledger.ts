import { randomUUID } from "node:crypto";
import { getDb } from "../db.js";

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
}

export function getRecentLedgerText(opts: {
  guildId: string;
  channelId: string;
  limit?: number;
}): string {
  const db = getDb();
  const limit = opts.limit ?? 20;

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
