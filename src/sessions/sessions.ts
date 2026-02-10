import { randomUUID } from "node:crypto";
import { getDb } from "../db.js";

export type Session = {
  session_id: string;
  guild_id: string;
  started_at_ms: number;
  ended_at_ms: number | null;
  started_by_id: string | null;
  started_by_name: string | null;
};

export function startSession(
  guildId: string,
  startedById: string | null = null,
  startedByName: string | null = null
): Session {
  const db = getDb();
  const now = Date.now();
  const sessionId = randomUUID();

  db.prepare(
    "INSERT INTO sessions (session_id, guild_id, started_at_ms, ended_at_ms, started_by_id, started_by_name) VALUES (?, ?, ?, NULL, ?, ?)"
  ).run(sessionId, guildId, now, startedById, startedByName);

  return {
    session_id: sessionId,
    guild_id: guildId,
    started_at_ms: now,
    ended_at_ms: null,
    started_by_id: startedById,
    started_by_name: startedByName,
  };
}

export function endSession(guildId: string): number {
  const db = getDb();
  const now = Date.now();

  const info = db
    .prepare("UPDATE sessions SET ended_at_ms = ? WHERE guild_id = ? AND ended_at_ms IS NULL")
    .run(now, guildId);

  return info.changes;
}

export function getActiveSession(guildId: string): Session | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM sessions WHERE guild_id = ? AND ended_at_ms IS NULL ORDER BY started_at_ms DESC LIMIT 1")
    .get(guildId) as Session | undefined;

  return row ?? null;
}
