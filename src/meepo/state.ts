import { randomUUID } from "node:crypto";
import { getDb } from "../db.js";
import { startSession, endSession } from "../sessions/sessions.js";

export type MeepoInstance = {
  id: string;
  name: string;
  guild_id: string;
  channel_id: string;
  persona_seed: string | null;
  form_id: string;
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

  // Always start with meepo form on wake (transformations happen after wake)
  db.prepare(
    "INSERT INTO npc_instances (id, name, guild_id, channel_id, persona_seed, form_id, created_at_ms, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)"
  ).run(
    id,
    "Meepo",
    opts.guildId,
    opts.channelId,
    opts.personaSeed ?? null,
    "meepo", // Always start as default meepo
    now
  );

  console.log("Meepo woke up as form_id: meepo");

  // Day 4: auto-start session on wake
  startSession(opts.guildId);

  return {
    id,
    name: "Meepo",
    guild_id: opts.guildId,
    channel_id: opts.channelId,
    persona_seed: opts.personaSeed ?? null,
    form_id: "meepo",
    created_at_ms: now,
    is_active: 1,
  };
}

export function sleepMeepo(guildId: string): number {
  const db = getDb();
  
  // Day 4: auto-end session on sleep
  endSession(guildId);
  
  const info = db
    .prepare("UPDATE npc_instances SET is_active = 0 WHERE guild_id = ? AND is_active = 1")
    .run(guildId);
  return info.changes;
}

export function transformMeepo(guildId: string, formId: string): { success: boolean; error?: string } {
  const db = getDb();
  
  const active = getActiveMeepo(guildId);
  if (!active) {
    return { success: false, error: "No active Meepo to transform" };
  }
  
  console.log("Transforming:", active.form_id, "→", formId);
  
  const info = db
    .prepare("UPDATE npc_instances SET form_id = ? WHERE guild_id = ? AND is_active = 1")
    .run(formId, guildId);
  
  return { success: info.changes > 0 };
}
