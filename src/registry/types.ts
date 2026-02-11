export type CharacterType = "pc" | "npc";
export type EntityKind = "pc" | "npc" | "location" | "faction";

export type Character = {
  id: string;
  canonical_name: string;
  type: CharacterType;
  discord_user_id?: string;
  aliases: string[];
  notes?: string;
};

// YAML schema doesn't require type (inferred from file)
export type RawCharacter = Omit<Character, 'type'> & { type?: CharacterType };

export type Location = {
  id: string;
  canonical_name: string;
  aliases: string[];
  notes?: string;
};

export type Faction = {
  id: string;
  canonical_name: string;
  aliases: string[];
  notes?: string;
};

export type Entity = Character | Location | Faction;

export type RawRegistryYaml = {
  version: number;
  characters?: RawCharacter[];
  locations?: Location[];
  factions?: Faction[];
};

export type LoadedRegistry = {
  version: number;
  characters: Character[];
  locations: Location[];
  factions: Faction[];
  byId: Map<string, Entity>;
  byDiscordUserId: Map<string | undefined, Character>;
  byName: Map<string, Entity>; // normalized key -> entity
  ignore: Set<string>; // normalized ignore tokens
};
