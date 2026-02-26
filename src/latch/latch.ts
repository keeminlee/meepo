import { getDbForCampaign } from "../db.js";
import { resolveCampaignSlug } from "../campaign/guildConfig.js";
import { log } from "../utils/logger.js";
import { getEnvNumber } from "../config/rawEnv.js";

const latchLog = log.withScope("latch");

const DEFAULT_LATCH_SECONDS = getEnvNumber("LATCH_SECONDS", 30);
const DEFAULT_MAX_LATCH_TURNS = getEnvNumber("LATCH_MAX_TURNS", 5);

function latchKey(guildId: string, channelId: string, userId: string): string {
  return `${guildId}:${channelId}:${userId}`;
}

type LatchRow = { expires_at_ms: number; turn_count: number; max_turns: number | null };

function getLatchDbForGuild(guildId: string) {
  const campaignSlug = resolveCampaignSlug({ guildId });
  return getDbForCampaign(campaignSlug);
}

export function getLatchExpiresAt(guildId: string, channelId: string, userId: string): number | null {
  const db = getLatchDbForGuild(guildId);
  const row = db
    .prepare(
      "SELECT expires_at_ms FROM latches WHERE guild_id = ? AND channel_id = ? AND user_id = ?"
    )
    .get(guildId, channelId, userId) as { expires_at_ms: number } | undefined;
  return row ? row.expires_at_ms : null;
}

/**
 * Latch is active for this (guild, channel, user) if not expired by time AND not expired by turn count.
 */
export function isLatchActive(
  guildId: string,
  channelId: string,
  userId: string,
  nowMs: number = Date.now()
): boolean {
  const db = getLatchDbForGuild(guildId);
  const row = db
    .prepare(
      "SELECT expires_at_ms, turn_count, max_turns FROM latches WHERE guild_id = ? AND channel_id = ? AND user_id = ?"
    )
    .get(guildId, channelId, userId) as LatchRow | undefined;
  let active: boolean;
  let reason: string;
  if (!row) {
    active = false;
    reason = "no row";
  } else if (nowMs >= row.expires_at_ms) {
    active = false;
    reason = "expired (time)";
  } else if (row.max_turns != null && row.turn_count >= row.max_turns) {
    active = false;
    reason = "expired (turns)";
  } else {
    active = true;
    reason = "active";
  }
  latchLog.debug("isLatchActive", {
    key: latchKey(guildId, channelId, userId),
    active,
    reason,
    ...(row && {
      expires_at_ms: row.expires_at_ms,
      turn_count: row.turn_count,
      max_turns: row.max_turns,
      nowMs,
    }),
  });
  return active;
}

/**
 * Set latch for this (guild, channel, user). Resets turn_count to 0.
 */
export function setLatch(
  guildId: string,
  channelId: string,
  userId: string,
  seconds: number = DEFAULT_LATCH_SECONDS,
  maxTurns: number | null = DEFAULT_MAX_LATCH_TURNS
): void {
  const db = getLatchDbForGuild(guildId);
  const expiresAt = Date.now() + seconds * 1000;
  db.prepare(
    `INSERT INTO latches (guild_id, channel_id, user_id, expires_at_ms, turn_count, max_turns)
     VALUES (?, ?, ?, ?, 0, ?)
     ON CONFLICT(guild_id, channel_id, user_id) DO UPDATE SET
       expires_at_ms = excluded.expires_at_ms,
       turn_count = 0,
       max_turns = excluded.max_turns`
  ).run(guildId, channelId, userId, expiresAt, maxTurns);
  latchLog.debug("setLatch", {
    key: latchKey(guildId, channelId, userId),
    seconds,
    maxTurns,
    expiresAt,
    expiresAtISO: new Date(expiresAt).toISOString(),
  });
}

/**
 * Increment turn count for this user's latch. Call only when we actually reply (not on every message).
 */
export function incrementLatchTurn(guildId: string, channelId: string, userId: string): void {
  const db = getLatchDbForGuild(guildId);
  db.prepare(
    "UPDATE latches SET turn_count = turn_count + 1 WHERE guild_id = ? AND channel_id = ? AND user_id = ?"
  ).run(guildId, channelId, userId);
  const row = db
    .prepare(
      "SELECT turn_count, max_turns FROM latches WHERE guild_id = ? AND channel_id = ? AND user_id = ?"
    )
    .get(guildId, channelId, userId) as { turn_count: number; max_turns: number | null } | undefined;
  latchLog.debug("incrementLatchTurn", {
    key: latchKey(guildId, channelId, userId),
    turn_count: row?.turn_count ?? null,
    max_turns: row?.max_turns ?? null,
  });
}

export function clearLatch(guildId: string, channelId: string, userId: string): void {
  const db = getLatchDbForGuild(guildId);
  db.prepare("DELETE FROM latches WHERE guild_id = ? AND channel_id = ? AND user_id = ?").run(
    guildId,
    channelId,
    userId
  );
  latchLog.debug("clearLatch", { key: latchKey(guildId, channelId, userId) });
}

export { DEFAULT_LATCH_SECONDS, DEFAULT_MAX_LATCH_TURNS };
