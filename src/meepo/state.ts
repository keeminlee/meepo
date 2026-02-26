import { randomUUID } from "node:crypto";
import { log } from "../utils/logger.js";
import { getDbForCampaign } from "../db.js";
import { resolveCampaignSlug } from "../campaign/guildConfig.js";
import { startSession, endSession } from "../sessions/sessions.js";
import { getGuildMode, sessionKindForMode } from "../sessions/sessionRuntime.js";

const meepoLog = log.withScope("meepo");

function getMeepoDbForGuild(guildId: string) {
  const campaignSlug = resolveCampaignSlug({ guildId });
  return getDbForCampaign(campaignSlug);
}

export type MeepoInstance = {
  id: string;
  name: string;
  guild_id: string;
  channel_id: string;
  persona_seed: string | null;
  form_id: string;
  reply_mode: string; // 'voice' | 'text'
  created_at_ms: number;
  is_active: number;
};

export function getActiveMeepo(guildId: string): MeepoInstance | null {
  const db = getMeepoDbForGuild(guildId);
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
  const db = getMeepoDbForGuild(opts.guildId);
  const now = Date.now();
  const id = randomUUID();

  // Deactivate any prior active instance for this guild (Day 2: one active Meepo per guild)
  db.prepare("UPDATE npc_instances SET is_active = 0 WHERE guild_id = ? AND is_active = 1")
    .run(opts.guildId);

  // Always start with meepo form on wake (transformations happen after wake)
  db.prepare(
    "INSERT INTO npc_instances (id, name, guild_id, channel_id, persona_seed, form_id, reply_mode, created_at_ms, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    id,
    "Meepo",
    opts.guildId,
    opts.channelId,
    opts.personaSeed ?? null,
    "meepo", // Always start as default meepo
    "text", // Default reply mode
    now,
    1 // is_active
  );

  meepoLog.info(`Woke up as form_id: meepo`);

  // Day 4: auto-start session on wake
  const mode = getGuildMode(opts.guildId);
  if (mode === "dormant") {
    meepoLog.info(`Guild mode is dormant; skipping auto session start on wake (guild=${opts.guildId})`);
  } else {
    startSession(opts.guildId, null, null, {
      source: "live",
      modeAtStart: mode,
      kind: sessionKindForMode(mode),
    });
  }

  return {
    id,
    name: "Meepo",
    guild_id: opts.guildId,
    channel_id: opts.channelId,
    persona_seed: opts.personaSeed ?? null,
    reply_mode: "text",
    form_id: "meepo",
    created_at_ms: now,
    is_active: 1,
  };
}

export function sleepMeepo(guildId: string): number {
  const db = getMeepoDbForGuild(guildId);
  
  // Day 4: auto-end session on sleep
  endSession(guildId);
  
  const info = db
    .prepare("UPDATE npc_instances SET is_active = 0 WHERE guild_id = ? AND is_active = 1")
    .run(guildId);
  return info.changes;
}

export function transformMeepo(guildId: string, formId: string): { success: boolean; error?: string } {
  const db = getMeepoDbForGuild(guildId);
  
  const active = getActiveMeepo(guildId);
  if (!active) {
    return { success: false, error: "No active Meepo to transform" };
  }
  
  meepoLog.info(`Transforming: ${active.form_id} → ${formId}`);
  
  const info = db
    .prepare("UPDATE npc_instances SET form_id = ? WHERE guild_id = ? AND is_active = 1")
    .run(formId, guildId);
  
  return { success: info.changes > 0 };
}
