import fs from "fs";
import path from "path";
import yaml from "yaml";
import { loadRegistry, normKey } from "../registry/loadRegistry.js";

/**
 * Cleanup: Remove aliases that contain the canonical name as a complete word
 * 
 * For example:
 *   - Keep "Henroch" as an alias for "Henroc" (doesn't contain exact word)
 *   - Remove "Henroc Steiner" (contains "Henroc" as a word)
 */

function cleanupCanonicalAliases(): void {
  console.log(`[cleanup-canonical-aliases] Loading registry...`);
  
  const dataDir = path.join(process.cwd(), "data", "registry");
  const pcsPath = path.join(dataDir, "pcs.yml");
  const npcsPath = path.join(dataDir, "npcs.yml");

  // Load files separately
  const pcsContent = fs.readFileSync(pcsPath, "utf-8");
  const npcsContent = fs.readFileSync(npcsPath, "utf-8");

  const pcsData = yaml.parse(pcsContent) as { characters: any[] };
  const npcsData = yaml.parse(npcsContent) as { characters: any[] };

  let totalRemoved = 0;

  // Process PCs
  for (const char of pcsData.characters) {
    const canonicalNorm = normKey(char.canonical_name);
    if (!canonicalNorm) continue;

    const originalAliasCount = char.aliases?.length || 0;
    
    // Filter out aliases that contain the canonical name as a word
    char.aliases = (char.aliases || []).filter((alias: string) => {
      const aliasNorm = normKey(alias);
      if (!aliasNorm) return true; // Keep if normalization fails

      // Check if canonical name appears as a complete word in the alias
      const words = aliasNorm.split(/\s+/);
      const containsCanonical = words.includes(canonicalNorm);

      if (containsCanonical) {
        console.log(`  Removing alias "${alias}" from ${char.canonical_name}`);
        totalRemoved++;
        return false;
      }

      return true;
    });

    if (char.aliases.length < originalAliasCount) {
      console.log(`${char.canonical_name}: ${originalAliasCount} → ${char.aliases.length} aliases`);
    }
  }

  // Process NPCs
  for (const char of npcsData.characters) {
    const canonicalNorm = normKey(char.canonical_name);
    if (!canonicalNorm) continue;

    const originalAliasCount = char.aliases?.length || 0;
    
    // Filter out aliases that contain the canonical name as a word
    char.aliases = (char.aliases || []).filter((alias: string) => {
      const aliasNorm = normKey(alias);
      if (!aliasNorm) return true; // Keep if normalization fails

      // Check if canonical name appears as a complete word in the alias
      const words = aliasNorm.split(/\s+/);
      const containsCanonical = words.includes(canonicalNorm);

      if (containsCanonical) {
        console.log(`  Removing alias "${alias}" from ${char.canonical_name}`);
        totalRemoved++;
        return false;
      }

      return true;
    });

    if (char.aliases.length < originalAliasCount) {
      console.log(`${char.canonical_name}: ${originalAliasCount} → ${char.aliases.length} aliases`);
    }
  }

  // Write back only the files we loaded
  fs.writeFileSync(pcsPath, yaml.stringify(pcsData));
  fs.writeFileSync(npcsPath, yaml.stringify(npcsData));

  console.log(`\n✅ Updated ${pcsPath}`);
  console.log(`✅ Updated ${npcsPath}`);

  console.log(`\n=== SUMMARY ===`);
  console.log(`Total aliases removed: ${totalRemoved}`);
}

// Main
try {
  cleanupCanonicalAliases();
} catch (err) {
  console.error("[cleanup-canonical-aliases] ERROR:", err instanceof Error ? err.message : err);
  process.exit(1);
}
