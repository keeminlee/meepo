/**
 * Mission Loader: Load and validate mission definitions from YAML
 * 
 * Provides runtime access to mission definitions for:
 * - /missions list
 * - /missions claim (validator)
 * - /missions status (cap checking)
 */

import fs from "fs";
import path from "path";
import YAML from "yaml";
import { log } from "../utils/logger.js";

const missionsLog = log.withScope("missions");

export type MissionKind = "permanent" | "temporary";
export type AppliesToType = 
  | "initiator_only"
  | "discoverer_only"
  | "decision_maker"
  | "standout_player"
  | "all_participants"
  | "both_participants";

export interface MissionReward {
  meeps: number;
  exceptional_meeps?: number;
}

export interface Mission {
  id: string;
  name: string;
  kind: MissionKind;
  max_per_player_per_session: number;
  reward: MissionReward;
  applies_to?: AppliesToType;
  description?: string;
}

interface MissionsConfig {
  missions: Mission[];
}

let cachedMissions: Map<string, Mission> | null = null;

/**
 * Load and cache missions from YAML
 */
function loadMissionsFromDisk(): Map<string, Mission> {
  const filePath = path.join(process.cwd(), "economy", "missions.yml");
  
  if (!fs.existsSync(filePath)) {
    missionsLog.warn(`Missions file not found: ${filePath}`);
    return new Map();
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const data = YAML.parse(raw) as MissionsConfig;

    if (!data?.missions || !Array.isArray(data.missions)) {
      missionsLog.warn(`Invalid missions config: missing 'missions' array`);
      return new Map();
    }

    // Validate and index missions
    const missions = new Map<string, Mission>();
    const seenIds = new Set<string>();

    for (const mission of data.missions) {
      // Validate required fields
      if (!mission.id || !mission.name || !mission.kind || !mission.max_per_player_per_session || !mission.reward) {
        missionsLog.warn(`Invalid mission: missing required fields: ${JSON.stringify(mission)}`);
        continue;
      }

      // Check for duplicate IDs
      if (seenIds.has(mission.id)) {
        missionsLog.warn(`Duplicate mission ID: ${mission.id}`);
        continue;
      }

      seenIds.add(mission.id);
      missions.set(mission.id, mission);
    }

    missionsLog.info(`Loaded ${missions.size} missions`);
    return missions;
  } catch (err: any) {
    missionsLog.error(`Failed to load missions: ${err.message ?? err}`);
    return new Map();
  }
}

/**
 * Get mission by ID (cached)
 */
export function getMissionById(missionId: string): Mission | null {
  if (!cachedMissions) {
    cachedMissions = loadMissionsFromDisk();
  }

  return cachedMissions.get(missionId) ?? null;
}

/**
 * List all missions
 */
export function listMissions(): Mission[] {
  if (!cachedMissions) {
    cachedMissions = loadMissionsFromDisk();
  }

  return Array.from(cachedMissions.values());
}

/**
 * Reload missions from disk (for debugging/hot-reload)
 */
export function reloadMissions(): void {
  cachedMissions = loadMissionsFromDisk();
  missionsLog.info(`Missions reloaded`);
}
