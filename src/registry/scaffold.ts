/**
 * Create minimal per-campaign registry directory and default YAML files if missing.
 * Used when loading registry for a campaign that has no folder yet.
 */

import fs from "fs";
import path from "path";

const DEFAULT_FILES: Array<{ name: string; content: string }> = [
  { name: "pcs.yml", content: "version: 1\n\ncharacters:\n" },
  { name: "npcs.yml", content: "version: 1\n\ncharacters:\n" },
  { name: "locations.yml", content: "version: 1\n\nlocations:\n" },
  { name: "factions.yml", content: "version: 1\n\nfactions:\n" },
  { name: "misc.yml", content: "version: 1\n\nmisc:\n" },
  { name: "ignore.yml", content: "version: 1\n\ntokens:\n" },
];

/**
 * Ensure registry directory exists and contains default files. Idempotent.
 */
export function ensureRegistryScaffold(registryDir: string): void {
  if (!fs.existsSync(registryDir)) {
    fs.mkdirSync(registryDir, { recursive: true });
  }
  for (const { name, content } of DEFAULT_FILES) {
    const filePath = path.join(registryDir, name);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content);
    }
  }
}

/**
 * Return the absolute path for a campaign's registry directory.
 */
export function getRegistryDirForCampaign(campaignSlug: string, baseDir?: string): string {
  const base = baseDir ?? path.join(process.cwd(), "data", "registry");
  return path.join(base, campaignSlug);
}
