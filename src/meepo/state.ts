import { randomUUID } from "node:crypto";
import { getDb } from "../db.js";

export type MeepoInstance = {
  id: string;
  name: string;
  guild_id: string;
  channel_id: string;
  persona_seed: string | null;
  created_at_ms: number;
  is_active: number;
};

export function getActiveMeepo(guildId: string): MeepoInstance | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT * FROM npc_instances WHERE guild_id = ? AND is_active = 1 ORDER BY created_at_ms DESC LIMIT 1"
    )
    .get(guildId) as MeepoInstance | undefined;

  return row ?? null;
}

export function wakeMeepo(opts: {
  guildId: string;
  channelId: string;
  personaSeed?: string | null;
}): MeepoInstance {
  const db = getDb();
  const now = Date.now();
  const id = randomUUID();

  // Deactivate any prior active instance for this guild (Day 2: one active Meepo per guild)
  db.prepare("UPDATE npc_instances SET is_active = 0 WHERE guild_id = ? AND is_active = 1")
    .run(opts.guildId);

  db.prepare(
    "INSERT INTO npc_instances (id, name, guild_id, channel_id, persona_seed, created_at_ms, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)"
  ).run(
    id,
    "Meepo",
    opts.guildId,
    opts.channelId,
    opts.personaSeed ?? null,
    now
  );

  return {
    id,
    name: "Meepo",
    guild_id: opts.guildId,
    channel_id: opts.channelId,
    persona_seed: opts.personaSeed ?? null,
    created_at_ms: now,
    is_active: 1,
  };
}

export function sleepMeepo(guildId: string): number {
  const db = getDb();
  const info = db
    .prepare("UPDATE npc_instances SET is_active = 0 WHERE guild_id = ? AND is_active = 1")
    .run(guildId);
  return info.changes;
}
