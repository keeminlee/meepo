import { getDb } from "../db.js";

const DEFAULT_LATCH_SECONDS = Number(process.env.LATCH_SECONDS ?? "30");
const DEFAULT_MAX_LATCH_TURNS = Number(process.env.LATCH_MAX_TURNS ?? "5");

function latchKey(guildId: string, channelId: string) {
  return guildId + ":" + channelId;
}

type LatchRow = { expires_at_ms: number; turn_count: number; max_turns: number | null };

export function getLatchExpiresAt(guildId: string, channelId: string): number | null {
  const db = getDb();
  const key = latchKey(guildId, channelId);
  const row = db
    .prepare("SELECT expires_at_ms FROM latches WHERE key = ?")
    .get(key) as { expires_at_ms: number } | undefined;
  return row ? row.expires_at_ms : null;
}

/**
 * Latch is active if not expired by time AND not expired by turn count.
 */
export function isLatchActive(guildId: string, channelId: string): boolean {
  const db = getDb();
  const key = latchKey(guildId, channelId);
  const row = db
    .prepare("SELECT expires_at_ms, turn_count, max_turns FROM latches WHERE key = ?")
    .get(key) as LatchRow | undefined;
  if (!row) return false;
  if (Date.now() >= row.expires_at_ms) return false;
  if (row.max_turns != null && row.turn_count >= row.max_turns) return false;
  return true;
}

/**
 * Set latch for this channel. Optionally set max_turns (N); latch expires when turn_count >= max_turns.
 */
export function setLatch(
  guildId: string,
  channelId: string,
  seconds: number = DEFAULT_LATCH_SECONDS,
  maxTurns: number | null = DEFAULT_MAX_LATCH_TURNS
) {
  const db = getDb();
  const key = latchKey(guildId, channelId);
  const expiresAt = Date.now() + seconds * 1000;
  db.prepare(
    `INSERT INTO latches (key, guild_id, channel_id, expires_at_ms, turn_count, max_turns) VALUES (?, ?, ?, ?, 0, ?)
     ON CONFLICT(key) DO UPDATE SET expires_at_ms=excluded.expires_at_ms, turn_count=0, max_turns=excluded.max_turns`
  ).run(key, guildId, channelId, expiresAt, maxTurns);
}

/**
 * Increment turn count for the channel's latch. Call when processing a message/utterance in that channel.
 */
export function incrementLatchTurn(guildId: string, channelId: string): void {
  const db = getDb();
  const key = latchKey(guildId, channelId);
  db.prepare("UPDATE latches SET turn_count = turn_count + 1 WHERE key = ?").run(key);
}

export function clearLatch(guildId: string, channelId: string) {
  const db = getDb();
  const key = latchKey(guildId, channelId);
  db.prepare("DELETE FROM latches WHERE key = ?").run(key);
}

export { DEFAULT_LATCH_SECONDS, DEFAULT_MAX_LATCH_TURNS };
