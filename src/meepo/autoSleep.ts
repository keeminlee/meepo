/**
 * Auto-Sleep: Automatically sleep Meepo after inactivity
 * 
 * Checks for ledger activity at regular intervals.
 * If no activity detected for configured duration, sleeps Meepo and ends session.
 */

import { getDb } from "../db.js";
import { getActiveMeepo, sleepMeepo } from "./state.js";

const AUTO_SLEEP_MS = Number(process.env.MEEPO_AUTO_SLEEP_MS ?? "600000"); // Default: 10 minutes
const CHECK_INTERVAL_MS = 60000; // Check every 60 seconds

let checkInterval: NodeJS.Timeout | null = null;

/**
 * Check for inactive Meepo instances and auto-sleep them.
 */
function checkInactivity() {
  const db = getDb();
  
  try {
    // Get all guilds with active Meepo instances
    const activeInstances = db
      .prepare("SELECT DISTINCT guild_id FROM npc_instances WHERE is_active = 1")
      .all() as { guild_id: string }[];

    for (const { guild_id } of activeInstances) {
      const active = getActiveMeepo(guild_id);
      if (!active) continue;

      // Get timestamp of most recent ledger entry for this guild
      const lastEntry = db
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
        console.log(
          `[AutoSleep] Sleeping Meepo in guild ${guild_id} after ${Math.round(inactiveMs / 60000)} minutes of inactivity`
        );
        sleepMeepo(guild_id);
      }
    }
  } catch (err: any) {
    console.error("[AutoSleep] Check failed:", err.message ?? err);
  }
}

/**
 * Start the auto-sleep checker.
 * Safe to call multiple times (idempotent).
 */
export function startAutoSleepChecker() {
  if (checkInterval) {
    console.warn("[AutoSleep] Checker already running");
    return;
  }

  if (AUTO_SLEEP_MS <= 0) {
    console.log("[AutoSleep] Disabled (MEEPO_AUTO_SLEEP_MS <= 0)");
    return;
  }

  console.log(
    `[AutoSleep] Starting checker (timeout: ${AUTO_SLEEP_MS / 60000} minutes, check interval: ${CHECK_INTERVAL_MS / 1000}s)`
  );

  checkInterval = setInterval(checkInactivity, CHECK_INTERVAL_MS);
}

/**
 * Stop the auto-sleep checker.
 */
export function stopAutoSleepChecker() {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
    console.log("[AutoSleep] Checker stopped");
  }
}
