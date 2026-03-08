export type DiscordGuildSnapshotSource =
  | "session_snapshot"
  | "discord_refresh"
  | "session_snapshot_fallback";

export type DiscordGuildSnapshotMeta = {
  source: DiscordGuildSnapshotSource;
  ttlMs: number;
  lastSyncedAtMs: number | null;
  lastRefreshAttemptAtMs: number | null;
};

const DEFAULT_GUILD_SNAPSHOT_TTL_MS = 5 * 60 * 1000;

export function resolveGuildSnapshotTtlMs(rawValue?: string | null): number {
  const raw = rawValue?.trim();
  if (!raw) return DEFAULT_GUILD_SNAPSHOT_TTL_MS;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_GUILD_SNAPSHOT_TTL_MS;
  if (parsed <= 0) return DEFAULT_GUILD_SNAPSHOT_TTL_MS;

  return Math.floor(parsed);
}

export function isGuildSnapshotStale(args: {
  nowMs: number;
  lastSyncedAtMs: number | null | undefined;
  ttlMs: number;
}): boolean {
  if (!args.lastSyncedAtMs) {
    return true;
  }
  return args.nowMs - args.lastSyncedAtMs >= args.ttlMs;
}

export function toSnapshotMeta(args: {
  source: DiscordGuildSnapshotSource;
  ttlMs: number;
  lastSyncedAtMs: number | null;
  lastRefreshAttemptAtMs: number | null;
}): DiscordGuildSnapshotMeta {
  return {
    source: args.source,
    ttlMs: args.ttlMs,
    lastSyncedAtMs: args.lastSyncedAtMs,
    lastRefreshAttemptAtMs: args.lastRefreshAttemptAtMs,
  };
}

export function toRefreshFailureMeta(args: {
  previousLastSyncedAtMs: number | null;
  nowMs: number;
  ttlMs: number;
}): DiscordGuildSnapshotMeta {
  // Preserve last successful snapshot time so staleness remains anchored to real data freshness.
  return {
    source: "session_snapshot_fallback",
    ttlMs: args.ttlMs,
    lastSyncedAtMs: args.previousLastSyncedAtMs,
    lastRefreshAttemptAtMs: args.nowMs,
  };
}
