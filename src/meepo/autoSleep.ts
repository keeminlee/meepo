/**
 * Auto-Sleep: Automatically sleep Meepo after inactivity
 * 
 * Checks for ledger activity at regular intervals.
 * If no activity detected for configured duration, sleeps Meepo and ends session.
 */

import { log } from "../utils/logger.js";
import { getActiveMeepo, sleepMeepo } from "./state.js";
import { cfg } from "../config/env.js";
import { resolveCampaignSlug } from "../campaign/guildConfig.js";
import { getDbForCampaign } from "../db.js";
import { getControlDb } from "../db.js";

const meepoLog = log.withScope("meepo");

const AUTO_SLEEP_MS = cfg.session.autoSleepMs;
const CHECK_INTERVAL_MS = 60000; // Check every 60 seconds

let checkInterval: NodeJS.Timeout | null = null;

/**
 * Check for inactive Meepo instances and auto-sleep them.
 */
function checkInactivity() {
  const controlDb = getControlDb();
  
  try {
    // Get all guilds with active Meepo instances
    const activeInstances = controlDb
      .prepare("SELECT DISTINCT guild_id FROM npc_instances WHERE is_active = 1")
      .all() as { guild_id: string }[];

    for (const { guild_id } of activeInstances) {
      const active = getActiveMeepo(guild_id);
      if (!active) continue;

      const campaignSlug = resolveCampaignSlug({ guildId: guild_id });
      const campaignDb = getDbForCampaign(campaignSlug);

      // Get timestamp of most recent ledger entry for this guild
      const lastEntry = campaignDb
        .prepare(`
          SELECT timestamp_ms 
          FROM ledger_entries 
          WHERE guild_id = ? 
          ORDER BY timestamp_ms DESC 
          LIMIT 1
        `)
        .get(guild_id) as { timestamp_ms: number } | undefined;

      if (!lastEntry) continue;

      const now = Date.now();
      const inactiveMs = now - lastEntry.timestamp_ms;

      if (inactiveMs >= AUTO_SLEEP_MS) {
        meepoLog.info(`Sleeping Meepo after ${Math.round(inactiveMs / 60000)} minutes of inactivity`);
        sleepMeepo(guild_id);
      }
    }
  } catch (err: any) {
    meepoLog.error(`Check failed: ${err.message ?? err}`);
  }
}

/**
 * Start the auto-sleep checker.
 * Safe to call multiple times (idempotent).
 */
export function startAutoSleepChecker() {
  if (checkInterval) {
    meepoLog.warn("Checker already running");
    return;
  }

  if (AUTO_SLEEP_MS <= 0) {
    meepoLog.debug("Disabled (MEEPO_AUTO_SLEEP_MS <= 0)");
    return;
  }

  meepoLog.info(`Starting checker (timeout: ${AUTO_SLEEP_MS / 60000} minutes, check interval: ${CHECK_INTERVAL_MS / 1000}s)`);

  checkInterval = setInterval(checkInactivity, CHECK_INTERVAL_MS);
}

/**
 * Stop the auto-sleep checker.
 */
export function stopAutoSleepChecker() {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
    meepoLog.debug("Checker stopped");
  }
}
