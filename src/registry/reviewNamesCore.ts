import { normKey } from "./loadRegistry.js";

export type PendingCandidate = {
  key: string;
  display: string;
  count: number;
  primaryCount: number;
  examples: string[];
};

export type ReviewEntry = {
  id: string;
  canonical_name: string;
  aliases?: string[];
  discord_user_id?: string;
  notes?: string;
};

export function toSnakeCase(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

export function generateUniqueId(prefix: string, baseName: string, existingIds: ReadonlySet<string>): string {
  const base = `${prefix}_${toSnakeCase(baseName)}`;
  let candidate = base;
  let counter = 2;

  while (existingIds.has(candidate)) {
    candidate = `${base}_${counter}`;
    counter += 1;
  }

  return candidate;
}

export function addIgnoreToken(tokens: string[], key: string): { tokens: string[]; changed: boolean } {
  const normalized = normKey(key);
  if (!normalized) {
    return { tokens: [...tokens], changed: false };
  }

  const exists = tokens.some((token) => normKey(token) === normalized);
  if (exists) {
    return { tokens: [...tokens], changed: false };
  }

  return {
    tokens: [...tokens, normalized],
    changed: true,
  };
}

export function addAliasIfMissing(entry: ReviewEntry, aliasDisplay: string): { entry: ReviewEntry; changed: boolean } {
  const aliasKey = normKey(aliasDisplay);
  if (!aliasKey) {
    return { entry: { ...entry }, changed: false };
  }

  const canonicalKey = normKey(entry.canonical_name);
  if (aliasKey === canonicalKey) {
    return { entry: { ...entry }, changed: false };
  }

  const aliases = Array.isArray(entry.aliases) ? [...entry.aliases] : [];
  const exists = aliases.some((alias) => normKey(alias) === aliasKey);
  if (exists) {
    return {
      entry: {
        ...entry,
        aliases,
      },
      changed: false,
    };
  }

  aliases.push(aliasDisplay);
  return {
    entry: {
      ...entry,
      aliases,
    },
    changed: true,
  };
}

export function createRegistryEntry(args: {
  prefix: string;
  canonicalName: string;
  candidateDisplay: string;
  existingIds: ReadonlySet<string>;
  discordUserId?: string;
}): ReviewEntry {
  const id = generateUniqueId(args.prefix, args.canonicalName, args.existingIds);
  const canonicalKey = normKey(args.canonicalName);
  const originalKey = normKey(args.candidateDisplay);

  const aliases = originalKey && originalKey !== canonicalKey ? [args.candidateDisplay] : [];

  const entry: ReviewEntry = {
    id,
    canonical_name: args.canonicalName,
    aliases,
    notes: "",
  };

  if (args.discordUserId && args.discordUserId.trim()) {
    entry.discord_user_id = args.discordUserId.trim();
  }

  return entry;
}

export function removePendingAtIndex<T>(pending: T[], index: number): T[] {
  if (index < 0 || index >= pending.length) {
    return [...pending];
  }

  return [...pending.slice(0, index), ...pending.slice(index + 1)];
}
