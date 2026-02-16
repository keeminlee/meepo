import { DateTime } from "luxon";
import { log } from "./logger.js";

const timestampLog = log.withScope("timestamps");

/**
 * Get unix seconds for today at 9PM ET (America/New_York)
 *
 * Edge case:
 * If current time is already past 9PM ET, returns that timestamp (MVP behavior).
 * Future: could roll to next day with a flag if desired.
 *
 * Returns unix seconds (integer) suitable for Discord <t:...:R> formatting
 */
export function getTodayAtNinePmEtUnixSeconds(): number {
  const etNow = DateTime.now().setZone("America/New_York");
  const ninepmEt = etNow.set({ hour: 21, minute: 0, second: 0, millisecond: 0 });

  const unixSecs = Math.floor(ninepmEt.toSeconds());
  timestampLog.debug(`Today 9PM ET: ${ninepmEt.toISO()} → ${unixSecs}`);

  return unixSecs;
}
