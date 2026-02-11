import fs from "fs";
import path from "path";
import yaml from "yaml";
import * as readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { loadRegistry, normKey } from "../registry/loadRegistry.js";

/**
 * Phase 1B: Name Review Tool
 * 
 * Interactive CLI for reviewing pending name candidates.
 * Allows adding NPCs, locations, factions, or marking as ignore.
 * 
 * Usage:
 *   npx tsx src/tools/review-names.ts
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

/**
 * Main review loop.
 */
async function reviewNames(): Promise<void> {
  const registryDir = path.join(process.cwd(), "data", "registry");
  const pendingPath = path.join(registryDir, "decisions.pending.yml");
  
  if (!fs.existsSync(pendingPath)) {
    console.log(`❌ No pending decisions file found at ${pendingPath}`);
    console.log(`   Run scan-names.ts first to generate pending candidates.`);
    return;
  }

  console.log(`[review-names] Loading pending decisions...`);
  const pendingContent = fs.readFileSync(pendingPath, "utf-8");
  const pendingData = yaml.parse(pendingContent) as PendingDecisions;

  if (!pendingData.pending || pendingData.pending.length === 0) {
    console.log(`✅ No pending candidates to review!`);
    return;
  }

  console.log(`[review-names] Loading registry...`);
  const registry = loadRegistry();

  const rl = readline.createInterface({ input, output });

  console.log(`\n📋 Found ${pendingData.pending.length} pending candidates`);
  console.log(`   Source: ${pendingData.source.db}`);
  console.log(`   Generated: ${pendingData.generated_at}\n`);

  const npcsPath = path.join(registryDir, "npcs.yml");
  const locationsPath = path.join(registryDir, "locations.yml");
  const factionsPath = path.join(registryDir, "factions.yml");
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
      console.log(`  > ${ex.slice(0, 70)}...`);
    }
    
    // Check if already in registry
    if (registry.byName.has(candidate.key)) {
      console.log(`\n⚠️  WARNING: "${candidate.key}" already exists in registry!`);
      console.log(` Skipping or add to ignore.`);
    }

    console.log(`\nActions:`);
    console.log(`  [n] new npc`);
    console.log(`  [l] new location`);
    console.log(`  [f] new faction`);
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
    } else if (choice === "n" || choice === "l" || choice === "f") {
      const typeMap: Record<string, { prefix: string; path: string; arrayKey: string; label: string }> = {
        n: { prefix: "npc", path: npcsPath, arrayKey: "characters", label: "NPC" },
        l: { prefix: "loc", path: locationsPath, arrayKey: "locations", label: "Location" },
        f: { prefix: "faction", path: factionsPath, arrayKey: "factions", label: "Faction" },
      };

      const selected = typeMap[choice];
      const id = generateUniqueId(selected.prefix, candidate.display, registry);

      const entry: any = {
        id,
        canonical_name: candidate.display,
        aliases: [],
        notes: "",
      };

      console.log(`➕ Adding ${selected.label}: ${candidate.display} (${id})`);
      appendToYaml(selected.path, entry, selected.arrayKey);
      
      pendingData.pending.splice(index, 1);
     savePending(pendingPath, pendingData);
      
      console.log(`✅ Added to ${path.basename(selected.path)}`);
      
      // Reload registry to pick up new entry
      const updatedRegistry = loadRegistry();
      Object.assign(registry, updatedRegistry);
      
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
