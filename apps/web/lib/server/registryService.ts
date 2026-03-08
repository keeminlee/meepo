import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";
import { resolveWebAuthContext, WebAuthError } from "@/lib/server/authContext";
import { listWebCampaignsForGuilds } from "@/lib/server/campaignReaders";
import { WebDataError } from "@/lib/mappers/errorMappers";
import { getDemoCampaignSummary } from "@/lib/server/demoCampaign";
import type {
  RegistryCategoryKey,
  RegistryCreateEntryRequest,
  RegistryEntityDto,
  RegistryPendingActionRequest,
  RegistryPendingCandidateDto,
  RegistrySnapshotDto,
  RegistryUpdateEntryRequest,
} from "@/lib/registry/types";
import { normKey } from "../../../../src/registry/loadRegistry";
import {
  addAliasIfMissing,
  addIgnoreToken,
  createRegistryEntry,
  removePendingAtIndex,
} from "../../../../src/registry/reviewNamesCore";
import type { Faction, Location, Misc } from "../../../../src/registry/types";
import { getRegistryDirForCampaign } from "../../../../src/registry/scaffold";

type QueryInput = Record<string, string | string[] | undefined> | undefined;

type PendingCandidate = {
  key: string;
  display: string;
  count: number;
  primaryCount: number;
  examples: string[];
};

type PendingDoc = {
  version?: number;
  generated_at?: string;
  source?: {
    campaignSlug?: string;
    guildId?: string | null;
  };
  pending?: PendingCandidate[];
};

type RegistryRoot = {
  version?: number;
  characters?: Array<{
    id: string;
    canonical_name: string;
    aliases?: string[];
    notes?: string;
    discord_user_id?: string;
  }>;
  locations?: Location[];
  factions?: Faction[];
  misc?: Misc[];
};

type RegistryCharacterRow = {
  id: string;
  canonical_name: string;
  aliases?: string[];
  notes?: string;
  discord_user_id?: string;
};

type TolerantRegistryIndex = {
  categories: Record<RegistryCategoryKey, RegistryEntityDto[]>;
  ignoreTokens: string[];
  byName: Map<string, { id: string; category: RegistryCategoryKey }>;
  ids: Set<string>;
};

const CATEGORY_FILE_MAP: Record<RegistryCategoryKey, { file: string; arrayKey: keyof RegistryRoot }> = {
  pcs: { file: "pcs.yml", arrayKey: "characters" },
  npcs: { file: "npcs.yml", arrayKey: "characters" },
  locations: { file: "locations.yml", arrayKey: "locations" },
  factions: { file: "factions.yml", arrayKey: "factions" },
  misc: { file: "misc.yml", arrayKey: "misc" },
};

function getRepoRoot(): string {
  return path.resolve(process.cwd(), "..", "..");
}

function getRegistryBaseDir(): string {
  return path.join(getRepoRoot(), "data", "registry");
}

function getRegistryDir(campaignSlug: string): string {
  return getRegistryDirForCampaign(campaignSlug, getRegistryBaseDir());
}

function getPendingPath(campaignSlug: string): string {
  return path.join(getRegistryDir(campaignSlug), "decisions.pending.yml");
}

function getIgnorePath(campaignSlug: string): string {
  return path.join(getRegistryDir(campaignSlug), "ignore.yml");
}

function getCategoryPath(campaignSlug: string, category: RegistryCategoryKey): string {
  const mapping = CATEGORY_FILE_MAP[category];
  return path.join(getRegistryDir(campaignSlug), mapping.file);
}

function parseYamlFile<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return (yaml.parse(raw) as T | null) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeYamlFile(filePath: string, value: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, yaml.stringify(value));
}

function mapCharacter(character: RegistryCharacterRow, category: "pcs" | "npcs"): RegistryEntityDto {
  return {
    id: character.id,
    canonicalName: character.canonical_name,
    aliases: Array.isArray(character.aliases) ? character.aliases : [],
    notes: character.notes ?? "",
    category,
    discordUserId: character.discord_user_id ?? null,
  };
}

function mapLocation(location: Location): RegistryEntityDto {
  return {
    id: location.id,
    canonicalName: location.canonical_name,
    aliases: Array.isArray(location.aliases) ? location.aliases : [],
    notes: location.notes ?? "",
    category: "locations",
    discordUserId: null,
  };
}

function mapFaction(faction: Faction): RegistryEntityDto {
  return {
    id: faction.id,
    canonicalName: faction.canonical_name,
    aliases: Array.isArray(faction.aliases) ? faction.aliases : [],
    notes: faction.notes ?? "",
    category: "factions",
    discordUserId: null,
  };
}

function mapMisc(misc: Misc): RegistryEntityDto {
  return {
    id: misc.id,
    canonicalName: misc.canonical_name,
    aliases: Array.isArray(misc.aliases) ? misc.aliases : [],
    notes: misc.notes ?? "",
    category: "misc",
    discordUserId: null,
  };
}

function normalizeAliases(input: string[] | undefined): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const alias of input) {
    const trimmed = alias.trim();
    if (!trimmed) continue;
    const key = normKey(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function readIgnoreTokens(campaignSlug: string): string[] {
  const ignoreDoc = parseYamlFile<{ version?: number; tokens?: string[] }>(getIgnorePath(campaignSlug), {
    version: 1,
    tokens: [],
  });

  const tokens = Array.isArray(ignoreDoc.tokens) ? ignoreDoc.tokens : [];
  const normalized = new Set<string>();
  for (const token of tokens) {
    const key = normKey(token);
    if (!key) continue;
    normalized.add(key);
  }
  return Array.from(normalized.values()).sort((a, b) => a.localeCompare(b));
}

function loadRegistryIndex(campaignSlug: string): TolerantRegistryIndex {
  const pcsDoc = readCategoryDoc(campaignSlug, "pcs");
  const npcsDoc = readCategoryDoc(campaignSlug, "npcs");
  const locationsDoc = readCategoryDoc(campaignSlug, "locations");
  const factionsDoc = readCategoryDoc(campaignSlug, "factions");
  const miscDoc = readCategoryDoc(campaignSlug, "misc");

  const pcs = (Array.isArray(pcsDoc.characters) ? pcsDoc.characters : []).map((entry) =>
    mapCharacter(entry, "pcs")
  );
  const npcs = (Array.isArray(npcsDoc.characters) ? npcsDoc.characters : []).map((entry) =>
    mapCharacter(entry, "npcs")
  );
  const locations = (Array.isArray(locationsDoc.locations) ? locationsDoc.locations : []).map(mapLocation);
  const factions = (Array.isArray(factionsDoc.factions) ? factionsDoc.factions : []).map(mapFaction);
  const misc = (Array.isArray(miscDoc.misc) ? miscDoc.misc : []).map(mapMisc);

  const categories: Record<RegistryCategoryKey, RegistryEntityDto[]> = {
    pcs,
    npcs,
    locations,
    factions,
    misc,
  };

  const byName = new Map<string, { id: string; category: RegistryCategoryKey }>();
  const ids = new Set<string>();
  for (const [category, entities] of Object.entries(categories) as Array<[RegistryCategoryKey, RegistryEntityDto[]]>) {
    for (const entity of entities) {
      if (entity.id.trim()) {
        ids.add(entity.id);
      }

      const canonicalKey = normKey(entity.canonicalName);
      if (canonicalKey && !byName.has(canonicalKey)) {
        byName.set(canonicalKey, { id: entity.id, category });
      }

      for (const alias of entity.aliases) {
        const aliasKey = normKey(alias);
        if (aliasKey && !byName.has(aliasKey)) {
          byName.set(aliasKey, { id: entity.id, category });
        }
      }
    }
  }

  return {
    categories,
    ignoreTokens: readIgnoreTokens(campaignSlug),
    byName,
    ids,
  };
}

async function getAuthorizedCampaign(campaignSlug: string, searchParams?: QueryInput) {
  let auth = null as Awaited<ReturnType<typeof resolveWebAuthContext>> | null;
  try {
    auth = await resolveWebAuthContext(searchParams);
  } catch (error) {
    if (error instanceof WebAuthError && error.reason === "unsigned") {
      if (campaignSlug === "demo") {
        return getDemoCampaignSummary();
      }
      throw new WebDataError("unauthorized", 401, "Sign-in required for campaign compendium access.");
    }
    throw error;
  }

  const model = await listWebCampaignsForGuilds({
    authorizedGuildIds: auth.authorizedGuildIds,
    authorizedGuilds: auth.authorizedGuilds,
  });

  const campaign = model.campaigns.find((item) => item.slug === campaignSlug);
  if (!campaign) {
    throw new WebDataError("not_found", 404, `Campaign not found: ${campaignSlug}`);
  }

  return campaign;
}

async function assertAuthorizedCampaign(campaignSlug: string, searchParams?: QueryInput): Promise<void> {
  await getAuthorizedCampaign(campaignSlug, searchParams);
}

async function assertCampaignEditable(campaignSlug: string, searchParams?: QueryInput): Promise<void> {
  const campaign = await getAuthorizedCampaign(campaignSlug, searchParams);
  if (campaign.editable === false) {
    throw new WebDataError("invalid_request", 422, "This campaign is read-only.");
  }
}

function loadRegistrySnapshot(campaignSlug: string): RegistrySnapshotDto {
  const index = loadRegistryIndex(campaignSlug);

  const pendingDoc = parseYamlFile<PendingDoc>(getPendingPath(campaignSlug), {});
  const pendingItems: RegistryPendingCandidateDto[] = Array.isArray(pendingDoc.pending)
    ? pendingDoc.pending.map((item) => ({
        key: item.key,
        display: item.display,
        count: item.count,
        primaryCount: item.primaryCount,
        examples: Array.isArray(item.examples) ? item.examples : [],
      }))
    : [];

  return {
    campaignSlug,
    categories: index.categories,
    ignoreTokens: index.ignoreTokens,
    pending: {
      generatedAt: pendingDoc.generated_at ?? null,
      sourceCampaignSlug: pendingDoc.source?.campaignSlug ?? null,
      sourceGuildId: pendingDoc.source?.guildId ?? null,
      items: pendingItems,
    },
  };
}

function assertNameCollision(
  campaignSlug: string,
  input: {
    canonicalName: string;
    aliases: string[];
    currentEntityId?: string;
  }
): void {
  const registry = loadRegistryIndex(campaignSlug);

  const normalizedNames = [input.canonicalName, ...input.aliases]
    .map((value) => normKey(value))
    .filter((value) => value.length > 0);

  for (const name of normalizedNames) {
    const hit = registry.byName.get(name);
    if (!hit) continue;
    if (input.currentEntityId && hit.id === input.currentEntityId) {
      continue;
    }

    throw new WebDataError("conflict", 409, `Registry name conflict for '${name}'.`);
  }
}

function getEntityList(doc: RegistryRoot, category: RegistryCategoryKey): RegistryRoot["characters"] | Location[] | Faction[] | Misc[] {
  const mapping = CATEGORY_FILE_MAP[category];
  const existing = doc[mapping.arrayKey];
  if (Array.isArray(existing)) {
    return existing as RegistryRoot["characters"] | Location[] | Faction[] | Misc[];
  }

  doc[mapping.arrayKey] = [] as never;
  return doc[mapping.arrayKey] as RegistryRoot["characters"] | Location[] | Faction[] | Misc[];
}

function readCategoryDoc(campaignSlug: string, category: RegistryCategoryKey): RegistryRoot {
  return parseYamlFile<RegistryRoot>(getCategoryPath(campaignSlug, category), { version: 1 });
}

function writeCategoryDoc(campaignSlug: string, category: RegistryCategoryKey, doc: RegistryRoot): void {
  writeYamlFile(getCategoryPath(campaignSlug, category), doc);
}

export async function getWebRegistrySnapshot(args: {
  campaignSlug: string;
  searchParams?: QueryInput;
}): Promise<RegistrySnapshotDto> {
  await assertAuthorizedCampaign(args.campaignSlug, args.searchParams);
  return loadRegistrySnapshot(args.campaignSlug);
}

export async function createWebRegistryEntry(args: {
  campaignSlug: string;
  searchParams?: QueryInput;
  body: RegistryCreateEntryRequest;
}): Promise<RegistrySnapshotDto> {
  await assertCampaignEditable(args.campaignSlug, args.searchParams);

  const category = args.body.category;
  const canonicalName = args.body.canonicalName?.trim();
  if (!canonicalName) {
    throw new WebDataError("invalid_request", 422, "canonicalName is required.");
  }

  const aliases = normalizeAliases(args.body.aliases);
  assertNameCollision(args.campaignSlug, { canonicalName, aliases });

  const doc = readCategoryDoc(args.campaignSlug, category);
  const list = getEntityList(doc, category) as Array<Record<string, unknown>>;

  const registry = loadRegistryIndex(args.campaignSlug);
  const existingIds = new Set(registry.ids.values());

  if (category === "pcs" || category === "npcs") {
    const created = createRegistryEntry({
      prefix: category === "pcs" ? "pc" : "npc",
      canonicalName,
      candidateDisplay: canonicalName,
      existingIds,
      discordUserId: category === "pcs" ? args.body.discordUserId : undefined,
    });

    const entryAliases = normalizeAliases([...(created.aliases ?? []), ...aliases]);
    list.push({
      id: created.id,
      canonical_name: canonicalName,
      aliases: entryAliases,
      notes: args.body.notes?.trim() ?? "",
      ...(category === "pcs" && args.body.discordUserId?.trim()
        ? { discord_user_id: args.body.discordUserId.trim() }
        : {}),
    });
  } else {
    const prefix = category === "locations" ? "loc" : category === "factions" ? "faction" : "misc";
    const created = createRegistryEntry({
      prefix,
      canonicalName,
      candidateDisplay: canonicalName,
      existingIds,
    });
    list.push({
      id: created.id,
      canonical_name: canonicalName,
      aliases,
      notes: args.body.notes?.trim() ?? "",
    });
  }

  writeCategoryDoc(args.campaignSlug, category, doc);
  return loadRegistrySnapshot(args.campaignSlug);
}

export async function updateWebRegistryEntry(args: {
  campaignSlug: string;
  entryId: string;
  searchParams?: QueryInput;
  body: RegistryUpdateEntryRequest;
}): Promise<RegistrySnapshotDto> {
  await assertCampaignEditable(args.campaignSlug, args.searchParams);

  const category = args.body.category;
  const doc = readCategoryDoc(args.campaignSlug, category);
  const list = getEntityList(doc, category) as Array<Record<string, unknown>>;
  const index = list.findIndex((entry) => String(entry.id) === args.entryId);

  if (index < 0) {
    throw new WebDataError("not_found", 404, `Registry entry not found: ${args.entryId}`);
  }

  const current = list[index];
  const nextCanonicalName = args.body.canonicalName?.trim() || String(current.canonical_name ?? "").trim();
  if (!nextCanonicalName) {
    throw new WebDataError("invalid_request", 422, "canonicalName cannot be empty.");
  }

  const nextAliases = args.body.aliases ? normalizeAliases(args.body.aliases) : normalizeAliases(Array.isArray(current.aliases) ? (current.aliases as string[]) : []);

  assertNameCollision(args.campaignSlug, {
    canonicalName: nextCanonicalName,
    aliases: nextAliases,
    currentEntityId: args.entryId,
  });

  const updated: Record<string, unknown> = {
    ...current,
    canonical_name: nextCanonicalName,
    aliases: nextAliases,
    notes: args.body.notes !== undefined ? args.body.notes.trim() : String(current.notes ?? ""),
  };

  if (category === "pcs") {
    if (args.body.discordUserId === null || args.body.discordUserId === "") {
      delete updated.discord_user_id;
    } else if (typeof args.body.discordUserId === "string") {
      updated.discord_user_id = args.body.discordUserId.trim();
    }
  } else {
    delete updated.discord_user_id;
  }

  list[index] = updated;
  writeCategoryDoc(args.campaignSlug, category, doc);
  return loadRegistrySnapshot(args.campaignSlug);
}

export async function applyWebRegistryPendingAction(args: {
  campaignSlug: string;
  searchParams?: QueryInput;
  body: RegistryPendingActionRequest;
}): Promise<RegistrySnapshotDto> {
  await assertCampaignEditable(args.campaignSlug, args.searchParams);

  const pendingPath = getPendingPath(args.campaignSlug);
  const pendingDoc = parseYamlFile<PendingDoc>(pendingPath, { version: 1, pending: [] });
  const pending = Array.isArray(pendingDoc.pending) ? [...pendingDoc.pending] : [];
  const index = pending.findIndex((item) => item.key === args.body.key);

  if (index < 0) {
    throw new WebDataError("not_found", 404, `Pending candidate not found: ${args.body.key}`);
  }

  const candidate = pending[index];

  if (args.body.action === "delete") {
    pendingDoc.pending = removePendingAtIndex(pending, index);
    writeYamlFile(pendingPath, pendingDoc);
    return loadRegistrySnapshot(args.campaignSlug);
  }

  if (args.body.action === "reject") {
    const ignorePath = getIgnorePath(args.campaignSlug);
    const ignoreDoc = parseYamlFile<{ version?: number; tokens?: string[] }>(ignorePath, { version: 1, tokens: [] });
    const currentTokens = Array.isArray(ignoreDoc.tokens) ? ignoreDoc.tokens : [];
    const nextTokens = addIgnoreToken(currentTokens, candidate.key);

    if (nextTokens.changed) {
      ignoreDoc.tokens = nextTokens.tokens;
      writeYamlFile(ignorePath, ignoreDoc);
    }

    pendingDoc.pending = removePendingAtIndex(pending, index);
    writeYamlFile(pendingPath, pendingDoc);
    return loadRegistrySnapshot(args.campaignSlug);
  }

  const category = args.body.category;
  const canonicalName = args.body.canonicalName?.trim() || candidate.display;
  const doc = readCategoryDoc(args.campaignSlug, category);
  const list = getEntityList(doc, category) as Array<Record<string, unknown>>;
  const registry = loadRegistryIndex(args.campaignSlug);

  const canonicalKey = normKey(canonicalName);
  const existingByCanonical = registry.byName.get(canonicalKey);

  if (existingByCanonical) {
    const targetIndex = list.findIndex((entry) => String(entry.id) === existingByCanonical.id);
    if (targetIndex < 0) {
      throw new WebDataError("conflict", 409, "Existing canonical target not found in selected category.");
    }

    const existing = list[targetIndex] as {
      id: string;
      canonical_name: string;
      aliases?: string[];
      notes?: string;
      discord_user_id?: string;
    };

    const aliasResult = addAliasIfMissing(
      {
        id: existing.id,
        canonical_name: existing.canonical_name,
        aliases: Array.isArray(existing.aliases) ? existing.aliases : [],
        notes: existing.notes,
        discord_user_id: existing.discord_user_id,
      },
      candidate.display
    );

    list[targetIndex] = {
      ...existing,
      aliases: aliasResult.entry.aliases ?? [],
    };
  } else {
    const existingIds = new Set(registry.ids.values());
    const prefix = category === "pcs" ? "pc" : category === "npcs" ? "npc" : category === "locations" ? "loc" : category === "factions" ? "faction" : "misc";
    const created = createRegistryEntry({
      prefix,
      canonicalName,
      candidateDisplay: candidate.display,
      existingIds,
      discordUserId: category === "pcs" ? args.body.discordUserId : undefined,
    });

    list.push({
      id: created.id,
      canonical_name: canonicalName,
      aliases: created.aliases ?? [],
      notes: args.body.notes?.trim() ?? "",
      ...(category === "pcs" && args.body.discordUserId?.trim()
        ? { discord_user_id: args.body.discordUserId.trim() }
        : {}),
    });
  }

  writeCategoryDoc(args.campaignSlug, category, doc);
  pendingDoc.pending = removePendingAtIndex(pending, index);
  writeYamlFile(pendingPath, pendingDoc);
  return loadRegistrySnapshot(args.campaignSlug);
}
