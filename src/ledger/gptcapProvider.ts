import fs from "fs";
import path from "path";
import { log } from "../utils/logger.js";
import { getEnv, getEnvBool } from "../config/rawEnv.js";

const ledgerLog = log.withScope("ledger");

/**
 * GptcapProvider: Loads and validates GPTcap (bootstrap) beats from disk.
 *
 * - Reads JSON from MEEPO_GPTCAPS_DIR (default: ./data/GPTcaps)
 * - Validates required fields: version, session_id, label, beats[]
 * - Each beat must have text (string) and lines (number[])
 * - Returns { session_id, label, beats[] } or null if invalid/missing
 * - Logs warning if invalid
 */

const GPTCAPS_ENABLED = getEnvBool("MEEPO_GPTCAPS_ENABLED", false);
const GPTCAPS_DIR = getEnv("MEEPO_GPTCAPS_DIR", "./data/GPTcaps") ?? "./data/GPTcaps";

export interface GptcapBeat {
  text: string;
  lines: number[];
  [key: string]: unknown;
}

export interface Gptcap {
  version: number | string;
  session_id: string;
  label: string;
  beats: GptcapBeat[];
  [key: string]: unknown;
}

function validateGptcap(obj: any): obj is Gptcap {
  if (!obj || typeof obj !== "object") return false;
  if (typeof obj.version !== "string" && typeof obj.version !== "number") return false;
  if (typeof obj.session_id !== "string") return false;
  if (typeof obj.label !== "string") return false;
  if (!Array.isArray(obj.beats)) return false;
  for (const beat of obj.beats) {
    if (typeof beat.text !== "string" || !Array.isArray(beat.lines)) return false;
    if (!beat.lines.every((n: any) => typeof n === "number")) return false;
  }
  return true;
}

/**
 * Loads a GPTcap JSON by session label or session_id.
 * @param sessionKey Session label (e.g. C2E6) or session_id
 * @returns Gptcap object or null if not found/invalid
 */
export function loadGptcap(sessionKey: string): Gptcap | null {
  if (!GPTCAPS_ENABLED) return null;
  // Always use label for indexing
  const filePath = path.join(GPTCAPS_DIR, "beats", `beats_${sessionKey}.json`);
  if (!fs.existsSync(filePath)) {
    ledgerLog.warn(`File not found: ${filePath}`);
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const obj = JSON.parse(raw);
    if (!validateGptcap(obj)) {
      ledgerLog.warn(`Invalid GPTcap schema in: ${filePath}`);
      return null;
    }
    return obj;
  } catch (err) {
    ledgerLog.warn(`Error loading ${filePath}: ${err}`);
    return null;
  }
}
