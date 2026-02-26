import fs from "fs";
import path from "path";
import yaml from "yaml";
import * as readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { loadRegistry, normKey } from "../../registry/loadRegistry.js";
import { getRegistryDirForCampaign } from "../../registry/scaffold.js";
import { resolveCampaignSlug } from "../../campaign/guildConfig.js";
import { getDefaultCampaignSlug } from "../../campaign/defaultCampaign.js";

/**
 * Phase 1B: Name Review Tool (campaign-scoped)
 *
 * Interactive CLI for reviewing pending name candidates.
 * Writes only to the selected campaign's registry folder.
 *
 * Usage:
 *   npx tsx src/tools/registry/review-names.ts --campaign faeterra-main
 *   npx tsx src/tools/registry/review-names.ts --campaign auto --guild 123456789012345678
 */

type PendingCandidate = {
  key: string;
  display: string;
  count: number;
  primaryCount: number;
  examples: string[];
};

type PendingDecisions = {
  version: number;
  generated_at: string;
  source: {
    db: string;
    guildId?: string | null;
    campaignSlug?: string;
    primaryOnly: boolean;
    minCount: number;
  };
  pending: PendingCandidate[];
};

/**
 * Convert string to snake_case for ID generation.
 */
function toSnakeCase(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

/**
 * Generate unique ID by checking existing registry and appending _2, _3, etc if needed.
 */
function generateUniqueId(prefix: string, baseName: string, registry: any): string {
  const base = `${prefix}_${toSnakeCase(baseName)}`;
  let candidate = base;
  let counter = 2;
  
  while (registry.byId.has(candidate)) {
    candidate = `${base}_${counter}`;
    counter++;
  }
  
  return candidate;
}

/**
 * Append entry to a YAML file with proper formatting and newline separators.
 */
function appendToYaml(filePath: string, entry: any, arrayKey: string): void {
  let content = "";
  
  if (fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, "utf-8");
  } else {
    content = `version: 1\n\n${arrayKey}:\n`;
  }

  // Parse to ensure it's valid
  const data = yaml.parse(content) || { version: 1 };
  if (!data[arrayKey]) {
    data[arrayKey] = [];
  }
  
  // Check if array is empty
  const wasEmpty = data[arrayKey].length === 0;
  
  data[arrayKey].push(entry);
  
  // Stringify with proper formatting
  let output = yaml.stringify(data);
  
  // Add blank line before the new entry if array wasn't empty
  if (!wasEmpty) {
    // Find the last occurrence of "  - id:" and add a blank line before it
    const lines = output.split('\n');
    let lastIdIndex = -1;
    
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].match(/^  - id:/)) {
        lastIdIndex = i;
        break;
      }
    }
    
    if (lastIdIndex > 0) {
      lines.splice(lastIdIndex, 0, '');
      output = lines.join('\n');
    }
  }
  
  fs.writeFileSync(filePath, output);
}

/**
 * Append normalized key to ignore.yml tokens list.
 */
function appendToIgnore(ignorePath: string, key: string): void {
  let content = "";
  
  if (fs.existsSync(ignorePath)) {
    content = fs.readFileSync(ignorePath, "utf-8");
  } else {
    content = `version: 1\n\ntokens:\n`;
  }

  const data = yaml.parse(content) || { version: 1, tokens: [] };
  if (!data.tokens) {
    data.tokens = [];
  }
  
  // Avoid duplicates
  if (!data.tokens.includes(key)) {
    data.tokens.push(key);
    fs.writeFileSync(ignorePath, yaml.stringify(data));
  }
}

/**
 * Save pending decisions (overwrites file).
 */
function savePending(pendingPath: string, data: PendingDecisions): void {
  fs.writeFileSync(pendingPath, yaml.stringify(data));
}

function parseArgs(): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = process.argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

function resolveCampaignFromArgs(args: Record<string, string | boolean>): string {
  const campaignOpt = (args.campaign as string) ?? "auto";
  const guildId = args.guild as string | undefined;
  if (campaignOpt !== "auto" && campaignOpt && String(campaignOpt).trim() !== "") {
    return String(campaignOpt).trim();
  }
  if (guildId) {
    return resolveCampaignSlug({ guildId });
  }
  return getDefaultCampaignSlug();
}

/**
 * Main review loop.
 */
async function reviewNames(): Promise<void> {
  const args = parseArgs();
  const guildId = (args.guild as string | undefined)?.trim() || null;
  const campaignSlug = resolveCampaignFromArgs(args);
  console.log(`Campaign: ${campaignSlug}`);
  if (guildId) {
    console.log(`Guild scope: ${guildId}`);
  } else {
    console.log("Guild scope: (not specified)");
  }

  const registryDir = getRegistryDirForCampaign(campaignSlug);
  const pendingPath = path.join(registryDir, "decisions.pending.yml");

  if (!fs.existsSync(pendingPath)) {
    console.log(`❌ No pending decisions file found at ${pendingPath}`);
    console.log(`   Run scan-names.ts first (with same --campaign/--guild) to generate pending candidates.`);
    return;
  }

  console.log(`[review-names] Loading pending decisions...`);
  const pendingContent = fs.readFileSync(pendingPath, "utf-8");
  const pendingData = yaml.parse(pendingContent) as PendingDecisions;

  const sourceCampaign = pendingData?.source?.campaignSlug;
  if (sourceCampaign && sourceCampaign !== campaignSlug) {
    throw new Error(
      `Pending file campaign mismatch: pending has ${sourceCampaign}, but active campaign is ${campaignSlug}. Run review with matching --campaign/--guild.`,
    );
  }

  const sourceGuild = pendingData?.source?.guildId ?? null;
  if (sourceGuild && guildId && sourceGuild !== guildId) {
    throw new Error(
      `Pending file guild mismatch: pending has guild ${sourceGuild}, but CLI --guild is ${guildId}.`,
    );
  }
  if (!sourceGuild) {
    console.log("⚠️  Pending file has no guild scope metadata (likely from older scan).");
  }

  if (!pendingData.pending || pendingData.pending.length === 0) {
    console.log(`✅ No pending candidates to review!`);
    return;
  }

  console.log(`[review-names] Loading registry...`);
  const registry = loadRegistry({ campaignSlug });

  const rl = readline.createInterface({ input, output });

  console.log(`\n📋 Found ${pendingData.pending.length} pending candidates`);
  console.log(`   Source: ${pendingData.source.db}`);
  console.log(`   Generated: ${pendingData.generated_at}\n`);

  const npcsPath = path.join(registryDir, "npcs.yml");
  const locationsPath = path.join(registryDir, "locations.yml");
  const factionsPath = path.join(registryDir, "factions.yml");
  const pcsPath = path.join(registryDir, "pcs.yml");
  const ignorePath = path.join(registryDir, "ignore.yml");

  let index = 0;
  while (index < pendingData.pending.length) {
    const candidate = pendingData.pending[index];
    
    console.log(`\n═══════════════════════════════════════════════════════════`);
    console.log(`📍 Candidate ${index + 1}/${pendingData.pending.length}`);
    console.log(`═══════════════════════════════════════════════════════════`);
    console.log(`\n${candidate.display}`);
    console.log(`  Count: ${candidate.count} total, ${candidate.primaryCount} primary`);
    console.log(`\nExamples:`);
    for (const ex of candidate.examples) {
      console.log(`  > ${ex}`);
    }
    
    // Check if already in registry
    if (registry.byName.has(candidate.key)) {
      console.log(`\n⚠️  WARNING: "${candidate.key}" already exists in registry!`);
      console.log(` Skipping or add to ignore.`);
    }

    console.log(`\nActions:`);
    console.log(`  [p] new pc`);
    console.log(`  [n] new npc`);
    console.log(`  [l] new location`);
    console.log(`  [f] new faction`);
    console.log(`  [m] new miscellaneous`);
    console.log(`  [i] add to ignore`);
    console.log(`  [d] delete from pending`);
    console.log(`  [s] skip (leave in pending)`);
    console.log(`  [q] quit`);

    const answer = await rl.question("\nChoice: ");
    const choice = answer.trim().toLowerCase();

    if (choice === "q") {
      console.log(`\n👋 Quitting. ${pendingData.pending.length - index} candidates remain in pending.`);
      break;
    } else if (choice === "s") {
      console.log(`⏭️  Skipped.`);
      index++;
      continue;
    } else if (choice === "i") {
      console.log(`🚫 Adding "${candidate.key}" to ignore list...`);
      appendToIgnore(ignorePath, candidate.key);
      pendingData.pending.splice(index, 1);
      savePending(pendingPath, pendingData);
      console.log(`✅ Added to ignore.yml`);
      continue; // Don't increment index, next candidate shifts down
    } else if (choice === "d") {
      console.log(`🗑️  Deleting "${candidate.display}" from pending...`);
      pendingData.pending.splice(index, 1);
      savePending(pendingPath, pendingData);
      console.log(`✅ Deleted from pending`);
      continue; // Don't increment index, next candidate shifts down
    } else if (choice === "n" || choice === "l" || choice === "f" || choice === "m" || choice === "p") {
      // Unified handler for all registry types (paths already campaign-scoped via registryDir)
      const miscPath = path.join(registryDir, "misc.yml");
      const typeMap: Record<string, { prefix: string; path: string; arrayKey: string; label: string }> = {
        p: { prefix: "pc", path: pcsPath, arrayKey: "characters", label: "Player Character" },
        n: { prefix: "npc", path: npcsPath, arrayKey: "characters", label: "NPC" },
        l: { prefix: "loc", path: locationsPath, arrayKey: "locations", label: "Location" },
        f: { prefix: "faction", path: factionsPath, arrayKey: "factions", label: "Faction" },
        m: { prefix: "misc", path: miscPath, arrayKey: "misc", label: "Miscellaneous" },
      };

      const selected = typeMap[choice];

      // Ask user for canonical name
      const userInput = await rl.question(`Enter canonical name for ${selected.label} (or press Enter to use "${candidate.display}"): `);
      let canonicalName = userInput.trim();

      if (!canonicalName) {
        canonicalName = candidate.display;
      }

      const canonicalKey = normKey(canonicalName);

      // Load current type's YAML to check for existing matches
      let currentTypeData: any = { version: 1 };
      if (fs.existsSync(selected.path)) {
        const content = fs.readFileSync(selected.path, "utf-8");
        currentTypeData = yaml.parse(content) || { version: 1 };
      }

      const itemsInType = currentTypeData[selected.arrayKey] || [];
      let existingEntryInType = null;

      // Check if canonical_name already exists in this type
      for (const item of itemsInType) {
        if (normKey(item.canonical_name) === canonicalKey) {
          existingEntryInType = item;
          break;
        }
        if (item.aliases) {
          for (const alias of item.aliases) {
            if (normKey(alias) === canonicalKey) {
              existingEntryInType = item;
              break;
            }
          }
        }
      }

      // Smart cross-reference check: see if this name exists in OTHER types
      let conflictFound = false;
      const otherTypesMap: Record<string, Array<{ type: string; path: string; label: string; arrayKey: string }>> = {
        p: [
          { type: "npcs", path: npcsPath, label: "NPC", arrayKey: "characters" },
          { type: "locations", path: locationsPath, label: "Location", arrayKey: "locations" },
          { type: "factions", path: factionsPath, label: "Faction", arrayKey: "factions" },
        ],
        n: [
          { type: "players", path: pcsPath, label: "Player Character", arrayKey: "characters" },
          { type: "locations", path: locationsPath, label: "Location", arrayKey: "locations" },
          { type: "factions", path: factionsPath, label: "Faction", arrayKey: "factions" },
        ],
        l: [
          { type: "players", path: pcsPath, label: "Player Character", arrayKey: "characters" },
          { type: "characters", path: npcsPath, label: "NPC", arrayKey: "characters" },
          { type: "factions", path: factionsPath, label: "Faction", arrayKey: "factions" },
        ],
        f: [
          { type: "players", path: pcsPath, label: "Player Character", arrayKey: "characters" },
          { type: "characters", path: npcsPath, label: "NPC", arrayKey: "characters" },
          { type: "locations", path: locationsPath, label: "Location", arrayKey: "locations" },
        ],
        m: [
          { type: "players", path: pcsPath, label: "Player Character", arrayKey: "characters" },
          { type: "characters", path: npcsPath, label: "NPC", arrayKey: "characters" },
          { type: "locations", path: locationsPath, label: "Location", arrayKey: "locations" },
          { type: "factions", path: factionsPath, label: "Faction", arrayKey: "factions" },
        ],
      };

      const otherTypes = otherTypesMap[choice] || [];

      // Only check for conflicts if this is a NEW canonical name in this type
      if (!existingEntryInType) {
        for (const otherType of otherTypes) {
          if (fs.existsSync(otherType.path)) {
            const content = fs.readFileSync(otherType.path, "utf-8");
            const data = yaml.parse(content) || {};
            const items = data[otherType.arrayKey] || [];

            for (const item of items) {
              if (normKey(item.canonical_name) === canonicalKey) {
                console.log(`\n⚠️  CONFLICT: "${canonicalName}" already exists as a ${otherType.label}!`);
                const override = await rl.question(`Are you sure you want to create it as a ${selected.label}? (y/n): `);
                if (override.trim().toLowerCase() !== "y") {
                  console.log(`❌ Cancelled.`);
                  conflictFound = true;
                  break;
                }
              }

              // Also check aliases
              if (item.aliases) {
                for (const alias of item.aliases) {
                  if (normKey(alias) === canonicalKey) {
                    console.log(`\n⚠️  CONFLICT: "${canonicalName}" is an alias for ${otherType.label} "${item.canonical_name}"!`);
                    const override = await rl.question(`Are you sure you want to create it as a ${selected.label}? (y/n): `);
                    if (override.trim().toLowerCase() !== "y") {
                      console.log(`❌ Cancelled.`);
                      conflictFound = true;
                      break;
                    }
                  }
                }
              }
            }

            if (conflictFound) break;
          }
        }
      }

      if (conflictFound) {
        continue; // Re-prompt for same candidate
      }

      // Process the entry
      if (existingEntryInType) {
        // Canonical name already exists in this type, add current name as alias
        const currentKey = normKey(candidate.display);

        if (!existingEntryInType.aliases) {
          existingEntryInType.aliases = [];
        }

        const aliasExists =
          existingEntryInType.aliases.some((a: string) => normKey(a) === currentKey) ||
          normKey(existingEntryInType.canonical_name) === currentKey;

        if (!aliasExists) {
          existingEntryInType.aliases.push(candidate.display);

          // Update the YAML file
          const idx = itemsInType.findIndex((item: any) => item.id === existingEntryInType.id);
          if (idx >= 0) {
            currentTypeData[selected.arrayKey][idx] = existingEntryInType;
            fs.writeFileSync(selected.path, yaml.stringify(currentTypeData));
            console.log(
              `✅ Added alias "${candidate.display}" to existing ${selected.label} "${existingEntryInType.canonical_name}"`
            );
          }
        } else {
          console.log(`ℹ️  "${candidate.display}" already exists as a name for this entry.`);
        }

        // Remove from pending
        pendingData.pending.splice(index, 1);
        savePending(pendingPath, pendingData);
      } else {
        // Create new entry
        const id = generateUniqueId(selected.prefix, canonicalName, registry);

        const entry: any = {
          id,
          canonical_name: canonicalName,
        };

        // For PCs, ask for discord_user_id
        if (choice === "p") {
          const discordId = await rl.question("Discord User ID (or press Enter to skip): ");
          if (discordId.trim()) {
            entry.discord_user_id = discordId.trim();
          }
        }

        // Add original name as alias if different from canonical name
        const originalKey = normKey(candidate.display);
        if (originalKey !== canonicalKey) {
          entry.aliases = [candidate.display];
        }

        entry.notes = "";

        console.log(`➕ Adding ${selected.label}: ${canonicalName} (${id})`);
        if (entry.aliases) {
          console.log(`   Alias: ${entry.aliases.join(", ")}`);
        }
        appendToYaml(selected.path, entry, selected.arrayKey);

        console.log(`✅ Added to ${path.basename(selected.path)}`);

        // Remove from pending
        pendingData.pending.splice(index, 1);
        savePending(pendingPath, pendingData);

        // Reload registry to pick up new entry
        const updatedRegistry = loadRegistry({ campaignSlug });
        Object.assign(registry, updatedRegistry);
      }

      continue; // Don't increment index
    } else {
      console.log(`❌ Invalid choice. Try again.`);
      continue; // Re-prompt for same candidate
    }
  }

  rl.close();

  console.log(`\n✅ Review complete!`);
  console.log(`   Remaining pending: ${pendingData.pending.length}`);
}

// Main
try {
  reviewNames();
} catch (err) {
  console.error("[review-names] ERROR:", err instanceof Error ? err.message : err);
  process.exit(1);
}
