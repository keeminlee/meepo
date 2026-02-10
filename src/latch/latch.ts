import { getDb } from "../db.js";

function latchKey(guildId: string, channelId: string) {
  return guildId + ":" + channelId;
}

export function getLatchExpiresAt(guildId: string, channelId: string): number | null {
  const db = getDb();
  const key = latchKey(guildId, channelId);
  const row = db
    .prepare("SELECT expires_at_ms FROM latches WHERE key = ?")
    .get(key) as { expires_at_ms: number } | undefined;

  return row ? row.expires_at_ms : null;
}

export function isLatchActive(guildId: string, channelId: string): boolean {
  const exp = getLatchExpiresAt(guildId, channelId);
  if (!exp) return false;
  return Date.now() < exp;
}

export function setLatch(guildId: string, channelId: string, seconds: number) {
  const db = getDb();
  const key = latchKey(guildId, channelId);
  const expiresAt = Date.now() + seconds * 1000;

  db.prepare(
    "INSERT INTO latches (key, guild_id, channel_id, expires_at_ms) VALUES (?, ?, ?, ?) " +
    "ON CONFLICT(key) DO UPDATE SET expires_at_ms=excluded.expires_at_ms"
  ).run(key, guildId, channelId, expiresAt);
}

export function clearLatch(guildId: string, channelId: string) {
  const db = getDb();
  const key = latchKey(guildId, channelId);
  db.prepare("DELETE FROM latches WHERE key = ?").run(key);
}
