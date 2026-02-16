import fs from "fs";
import path from "path";
import yaml from "yaml";
import { Character, Location, Faction, Misc, Entity, LoadedRegistry, RawRegistryYaml } from "./types.js";

/**
 * Single normalization function used everywhere.
 * - lowercase
 * - trim
 * - collapse whitespace
 * - strip surrounding punctuation
 */
function normKey(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "")
    .replace(/\s+/g, " ");
}

/**
 * Load and validate the character registry from multiple YAML files.
 * Loads pcs.yml, npcs.yml, locations.yml, factions.yml from registryPath directory.
 * Also loads ignore tokens from ignore.yml.
 * Hard fails on schema errors; soft warns on advisory issues.
 * @returns LoadedRegistry with fast lookup maps
 */
export function loadRegistry(opts?: {
  registryPath?: string;  // directory path, default: data/registry
  ignorePath?: string;    // ignore file path, default: data/registry/ignore.yml
}): LoadedRegistry {
  const registryDir = opts?.registryPath ?? path.join(process.cwd(), "data", "registry");
  const ignorePath = opts?.ignorePath ?? path.join(registryDir, "ignore.yml");
  
  if (!fs.existsSync(registryDir)) {
    throw new Error(`Registry directory not found: ${registryDir}`);
  }

  // Collect all characters, locations, factions, misc
  const allCharacters: Character[] = [];
  const allLocations: Location[] = [];
  const allFactions: Faction[] = [];
  const allMisc: Misc[] = [];

  // Load pcs.yml
  const pcsPath = path.join(registryDir, "pcs.yml");
  if (fs.existsSync(pcsPath)) {
    const pcsContent = fs.readFileSync(pcsPath, "utf-8");
    const pcsRaw = yaml.parse(pcsContent) as RawRegistryYaml;
    if (pcsRaw.characters && Array.isArray(pcsRaw.characters)) {
      // Auto-assign type: "pc" from file location
      const pcs = pcsRaw.characters.map(c => ({ ...c, type: "pc" as const }));
      allCharacters.push(...pcs);
    }
  }

  // Load npcs.yml
  const npcsPath = path.join(registryDir, "npcs.yml");
  if (fs.existsSync(npcsPath)) {
    const npcsContent = fs.readFileSync(npcsPath, "utf-8");
    const npcsRaw = yaml.parse(npcsContent) as RawRegistryYaml;
    if (npcsRaw.characters && Array.isArray(npcsRaw.characters)) {
      // Auto-assign type: "npc" from file location
      const npcs = npcsRaw.characters.map(c => ({ ...c, type: "npc" as const }));
      allCharacters.push(...npcs);
    }
  }

  // Load locations.yml
  const locPath = path.join(registryDir, "locations.yml");
  if (fs.existsSync(locPath)) {
    const locContent = fs.readFileSync(locPath, "utf-8");
    const locRaw = yaml.parse(locContent) as { version?: number; locations?: Location[] };
    if (locRaw.locations && Array.isArray(locRaw.locations)) {
      allLocations.push(...locRaw.locations);
    }
  }

  // Load factions.yml
  const facPath = path.join(registryDir, "factions.yml");
  if (fs.existsSync(facPath)) {
    const facContent = fs.readFileSync(facPath, "utf-8");
    const facRaw = yaml.parse(facContent) as { version?: number; factions?: Faction[] };
    if (facRaw.factions && Array.isArray(facRaw.factions)) {
      allFactions.push(...facRaw.factions);
    }
  }

  // Load misc.yml
  const miscPath = path.join(registryDir, "misc.yml");
  if (fs.existsSync(miscPath)) {
    const miscContent = fs.readFileSync(miscPath, "utf-8");
    const miscRaw = yaml.parse(miscContent) as { version?: number; misc?: any[] };
    if (miscRaw.misc && Array.isArray(miscRaw.misc)) {
      allMisc.push(...miscRaw.misc);
    }
  }

  // Validate and index characters
  const byId = new Map<string, Entity>();
  const byDiscordUserId = new Map<string | undefined, Character>();
  const byName = new Map<string, Entity>();
  const allEntities: Entity[] = [];

  for (const char of allCharacters) {
    if (!char.id) throw new Error(`Character missing id`);
    if (!char.canonical_name) throw new Error(`Character ${char.id} missing canonical_name`);
    // Default aliases to empty array if missing
    if (!Array.isArray(char.aliases)) {
      char.aliases = [];
    }

    if (byId.has(char.id)) throw new Error(`Duplicate id: ${char.id}`);

    if (char.type === "pc" && char.discord_user_id) {
      if (byDiscordUserId.has(char.discord_user_id)) {
        throw new Error(`Duplicate discord_user_id: ${char.discord_user_id}`);
      }
      byDiscordUserId.set(char.discord_user_id, char);
    }

    if (char.type === "pc" && !char.discord_user_id) {
      console.warn(`⚠️  PC "${char.canonical_name}" (${char.id}) missing discord_user_id`);
    }

    const canNorm = normKey(char.canonical_name);
    if (!canNorm) throw new Error(`Character ${char.id} canonical_name normalizes to empty`);

    if (byName.has(canNorm) && byName.get(canNorm)!.id !== char.id) {
      throw new Error(`Name collision on "${canNorm}" (${char.id})`);
    }
    byName.set(canNorm, char);

    for (const alias of char.aliases) {
      const alNorm = normKey(alias);
      if (!alNorm) throw new Error(`Character ${char.id} alias "${alias}" normalizes to empty`);

      if (alNorm === canNorm) {
        console.warn(`⚠️  Character ${char.id}: alias normalizes to canonical`);
      }

      if (byName.has(alNorm) && byName.get(alNorm)!.id !== char.id) {
        throw new Error(`Name collision on "${alNorm}"`);
      }
      byName.set(alNorm, char);
    }

    byId.set(char.id, char);
    allEntities.push(char);
  }

  // Index locations
  for (const loc of allLocations) {
    if (!loc.id) throw new Error(`Location missing id`);
    if (!loc.canonical_name) throw new Error(`Location ${loc.id} missing canonical_name`);
    // Default aliases to empty array if missing
    if (!Array.isArray(loc.aliases)) {
      loc.aliases = [];
    }

    if (byId.has(loc.id)) throw new Error(`Duplicate id: ${loc.id}`);

    const canNorm = normKey(loc.canonical_name);
    if (!canNorm) throw new Error(`Location ${loc.id} canonical_name normalizes to empty`);

    if (byName.has(canNorm) && byName.get(canNorm)!.id !== loc.id) {
      throw new Error(`Name collision on "${canNorm}"`);
    }
    byName.set(canNorm, loc);

    for (const alias of loc.aliases) {
      const alNorm = normKey(alias);
      if (!alNorm) throw new Error(`Location ${loc.id} alias normalizes to empty`);
      if (byName.has(alNorm) && byName.get(alNorm)!.id !== loc.id) {
        throw new Error(`Name collision on "${alNorm}"`);
      }
      byName.set(alNorm, loc);
    }

    byId.set(loc.id, loc);
    allEntities.push(loc);
  }

  // Index factions
  for (const fac of allFactions) {
    if (!fac.id) throw new Error(`Faction missing id`);
    if (!fac.canonical_name) throw new Error(`Faction ${fac.id} missing canonical_name`);
    // Default aliases to empty array if missing
    if (!Array.isArray(fac.aliases)) {
      fac.aliases = [];
    }

    if (byId.has(fac.id)) throw new Error(`Duplicate id: ${fac.id}`);

    const canNorm = normKey(fac.canonical_name);
    if (!canNorm) throw new Error(`Faction ${fac.id} canonical_name normalizes to empty`);

    if (byName.has(canNorm) && byName.get(canNorm)!.id !== fac.id) {
      throw new Error(`Name collision on "${canNorm}"`);
    }
    byName.set(canNorm, fac);

    for (const alias of fac.aliases) {
      const alNorm = normKey(alias);
      if (!alNorm) throw new Error(`Faction ${fac.id} alias normalizes to empty`);
      if (byName.has(alNorm) && byName.get(alNorm)!.id !== fac.id) {
        throw new Error(`Name collision on "${alNorm}"`);
      }
      byName.set(alNorm, fac);
    }

    byId.set(fac.id, fac);
    allEntities.push(fac);
  }

  // Index misc
  for (const misc of allMisc) {
    if (!misc.id) throw new Error(`Misc missing id`);
    if (!misc.canonical_name) throw new Error(`Misc ${misc.id} missing canonical_name`);
    // Default aliases to empty array if missing
    if (!Array.isArray(misc.aliases)) {
      misc.aliases = [];
    }

    if (byId.has(misc.id)) throw new Error(`Duplicate id: ${misc.id}`);

    const canNorm = normKey(misc.canonical_name);
    if (!canNorm) throw new Error(`Misc ${misc.id} canonical_name normalizes to empty`);

    if (byName.has(canNorm) && byName.get(canNorm)!.id !== misc.id) {
      throw new Error(`Name collision on "${canNorm}"`);
    }
    byName.set(canNorm, misc);

    for (const alias of misc.aliases) {
      const alNorm = normKey(alias);
      if (!alNorm) throw new Error(`Misc ${misc.id} alias normalizes to empty`);
      if (byName.has(alNorm) && byName.get(alNorm)!.id !== misc.id) {
        throw new Error(`Name collision on "${alNorm}"`);
      }
      byName.set(alNorm, misc);
    }

    byId.set(misc.id, misc);
    allEntities.push(misc);
  }

  // Load ignore tokens
  const ignore = new Set<string>();
  if (fs.existsSync(ignorePath)) {
    const ignoreContent = fs.readFileSync(ignorePath, "utf-8");
    const ignoreRaw = yaml.parse(ignoreContent) as { version?: number; tokens?: string[] };
    if (ignoreRaw.tokens && Array.isArray(ignoreRaw.tokens)) {
      for (const token of ignoreRaw.tokens) {
        const normalized = normKey(token);
        if (normalized) {
          ignore.add(normalized);
        }
      }
    }
  }

  return {
    version: 1,
    characters: allCharacters,
    locations: allLocations,
    factions: allFactions,
    misc: allMisc,
    byId,
    byDiscordUserId,
    byName,
    ignore,
  };
}

/**
 * Find a character by Discord user ID.
 */
export function findByDiscordUserId(
  registry: LoadedRegistry,
  id: string
): Character | undefined {
  return registry.byDiscordUserId.get(id);
}

/**
 * Find any entity by name (canonical or alias).
 * Automatically normalizes the input.
 * Returns the first match (character, location, or faction).
 */
export function findByName(
  registry: LoadedRegistry,
  name: string
): Entity | undefined {
  const normalized = normKey(name);
  return registry.byName.get(normalized);
}

/**
 * Check if a token should be ignored.
 * Automatically normalizes the input.
 */
export function isIgnoredToken(
  registry: LoadedRegistry,
  token: string
): boolean {
  const normalized = normKey(token);
  return registry.ignore.has(normalized);
}

/**
 * Export normalization function for external use.
 */
export { normKey };
