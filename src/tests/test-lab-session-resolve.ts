import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import {
  listAnchorsForAutocomplete,
  listSessionsForAutocomplete,
  resolveLatestUserAnchorLedgerId,
  resolveSessionSelection,
} from "../commands/shared/sessionResolve.js";

function createDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE sessions (
      session_id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      mode_at_start TEXT NOT NULL,
      label TEXT,
      started_at_ms INTEGER NOT NULL
    );

    CREATE TABLE ledger_entries (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT,
      author_id TEXT,
      author_name TEXT,
      timestamp_ms INTEGER NOT NULL,
      content TEXT NOT NULL,
      content_norm TEXT,
      session_id TEXT,
      tags TEXT,
      source TEXT NOT NULL
    );
  `);
  return db;
}

describe("lab session resolver", () => {
  test("defaults to most recent official canon session", () => {
    const db = createDb();
    db.prepare(`INSERT INTO sessions (session_id, guild_id, kind, mode_at_start, label, started_at_ms) VALUES
      ('s-dev', 'g1', 'canon', 'lab', 'dev replay', 3000),
      ('s-noncanon', 'g1', 'chat', 'ambient', 'chat run', 2500),
      ('s-old-official', 'g1', 'canon', 'canon', 'Arena Night 11', 2000),
      ('s-new-official', 'g1', 'canon', 'canon', 'Arena Night 12', 4000)
    `).run();

    const resolved = resolveSessionSelection({ guildId: "g1", channelId: "c1", db });
    expect(resolved?.sessionId).toBe("s-new-official");
    expect(resolved?.usedDefault).toBe(true);
  });

  test("session autocomplete includes dev/noncanon tags with compact labels", () => {
    const db = createDb();
    db.prepare(`INSERT INTO sessions (session_id, guild_id, kind, mode_at_start, label, started_at_ms) VALUES
      ('s-official', 'g1', 'canon', 'canon', 'Arena Night 12', 4000),
      ('s-dev', 'g1', 'canon', 'lab', 'retrieval test', 3000),
      ('s-noncanon', 'g1', 'chat', 'ambient', 'chat test', 2000)
    `).run();

    const choices = listSessionsForAutocomplete({ guildId: "g1", query: "", db });
    expect(choices).toHaveLength(3);
    expect(choices[0]?.value).toBe("s-official");
    expect(choices[0]?.name).not.toContain("s-official");
    expect(choices[1]?.name.startsWith("(dev) ")).toBe(true);
    expect(choices[2]?.name.startsWith("(noncanon) ")).toBe(true);
  });

  test("latest anchor resolves to latest user-message ledger id in session", () => {
    const db = createDb();
    db.prepare(`INSERT INTO sessions (session_id, guild_id, kind, mode_at_start, label, started_at_ms) VALUES
      ('s1', 'g1', 'canon', 'canon', 'Arena Night 12', 4000)
    `).run();

    db.prepare(`INSERT INTO ledger_entries (id, guild_id, channel_id, author_id, author_name, timestamp_ms, content, session_id, source) VALUES
      ('100', 'g1', 'c1', 'user-1', 'Alice', 1000, 'where are we headed?', 's1', 'text'),
      ('101', 'g1', 'c1', 'meepo-bot', 'Meepo', 1001, 'We head east.', 's1', 'text'),
      ('102', 'g1', 'c1', 'user-2', 'Bob', 1002, 'ok recap that fight', 's1', 'text')
    `).run();

    const latest = resolveLatestUserAnchorLedgerId({ guildId: "g1", sessionId: "s1", db });
    expect(latest).toBe("102");

    const anchors = listAnchorsForAutocomplete({ guildId: "g1", sessionId: "s1", query: "", db });
    expect(anchors[0]?.value).toBe("102");
    expect(anchors[0]?.name).toContain("ok recap that fight");
  });

  test("latest anchor returns null when session has no user-message anchors", () => {
    const db = createDb();
    db.prepare(`INSERT INTO sessions (session_id, guild_id, kind, mode_at_start, label, started_at_ms) VALUES
      ('s1', 'g1', 'canon', 'canon', 'Arena Night 12', 4000)
    `).run();

    db.prepare(`INSERT INTO ledger_entries (id, guild_id, channel_id, author_id, author_name, timestamp_ms, content, session_id, source) VALUES
      ('200', 'g1', 'c1', 'meepo-bot', 'Meepo', 1000, 'No users yet', 's1', 'text'),
      ('201', 'g1', 'c1', 'system', 'SYSTEM', 1001, 'heartbeat', 's1', 'system')
    `).run();

    const latest = resolveLatestUserAnchorLedgerId({ guildId: "g1", sessionId: "s1", db });
    expect(latest).toBeNull();
  });
});
