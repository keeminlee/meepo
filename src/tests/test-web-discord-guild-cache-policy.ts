// @ts-nocheck
import { describe, expect, it } from "vitest";
import {
  isGuildSnapshotStale,
  resolveGuildSnapshotTtlMs,
  toRefreshFailureMeta,
  toSnapshotMeta,
} from "../../apps/web/lib/server/discordGuildSnapshotCache";

describe("web discord guild cache policy", () => {
  it("uses default ttl when env value is missing or invalid", () => {
    expect(resolveGuildSnapshotTtlMs(undefined)).toBe(300000);
    expect(resolveGuildSnapshotTtlMs(null)).toBe(300000);
    expect(resolveGuildSnapshotTtlMs("not-a-number")).toBe(300000);
    expect(resolveGuildSnapshotTtlMs("0")).toBe(300000);
  });

  it("treats snapshot as fresh when within ttl", () => {
    const stale = isGuildSnapshotStale({
      nowMs: 1_000,
      lastSyncedAtMs: 800,
      ttlMs: 500,
    });
    expect(stale).toBe(false);
  });

  it("treats snapshot as stale when ttl is exceeded", () => {
    const stale = isGuildSnapshotStale({
      nowMs: 10_000,
      lastSyncedAtMs: 1_000,
      ttlMs: 500,
    });
    expect(stale).toBe(true);
  });

  it("preserves last synced time when refresh fails", () => {
    const meta = toRefreshFailureMeta({
      previousLastSyncedAtMs: 2_000,
      nowMs: 5_000,
      ttlMs: 300_000,
    });

    expect(meta.source).toBe("session_snapshot_fallback");
    expect(meta.lastSyncedAtMs).toBe(2_000);
    expect(meta.lastRefreshAttemptAtMs).toBe(5_000);
  });

  it("records snapshot source metadata when refresh is not required", () => {
    const meta = toSnapshotMeta({
      source: "session_snapshot",
      ttlMs: 300_000,
      lastSyncedAtMs: 4_000,
      lastRefreshAttemptAtMs: 4_500,
    });

    expect(meta.source).toBe("session_snapshot");
    expect(meta.lastSyncedAtMs).toBe(4_000);
    expect(meta.lastRefreshAttemptAtMs).toBe(4_500);
    expect(meta.ttlMs).toBe(300_000);
  });
});
