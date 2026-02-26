export const GOLD_MEMORY_COLUMNS = [
  "guild_id",
  "campaign_slug",
  "memory_key",
  "character",
  "summary",
  "details",
  "tags",
  "source_ids",
  "gravity",
  "certainty",
  "resilience",
  "status",
] as const;

export const GOLD_CANDIDATE_COLUMNS = [
  "guild_id",
  "campaign_slug",
  "candidate_key",
  "session_id",
  "character",
  "summary",
  "details",
  "tags",
  "source_ids",
  "gravity",
  "certainty",
  "resilience",
  "status",
] as const;

export type GoldMemoryCsvRow = {
  guild_id: string;
  campaign_slug: string;
  memory_key: string;
  character: string;
  summary: string;
  details: string;
  tags: string[];
  source_ids: string[];
  gravity: number;
  certainty: number;
  resilience: number;
  status: string;
};

export type GoldCandidateCsvRow = {
  guild_id: string;
  campaign_slug: string;
  candidate_key: string;
  session_id: string | null;
  character: string;
  summary: string;
  details: string;
  tags: string[];
  source_ids: string[];
  gravity: number;
  certainty: number;
  resilience: number;
  status: string;
};

function splitList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split("|")
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b));
}

function parseMetric(raw: string, fallback: number, field: string, strict: boolean): number {
  if (!raw.trim()) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    if (strict) {
      throw new Error(`Invalid ${field}: "${raw}"`);
    }
    return fallback;
  }
  return Math.max(0, Math.min(1, n));
}

function required(raw: string, field: string): string {
  const t = raw.trim();
  if (!t) throw new Error(`Missing required field: ${field}`);
  return t;
}

export function normalizeGoldMemoryCsvRecord(
  raw: Record<string, string>,
  opts: { strict: boolean; defaultGuildId: string; defaultCampaignSlug: string },
): GoldMemoryCsvRow {
  const guild_id = (raw.guild_id ?? "").trim() || opts.defaultGuildId;
  const campaign_slug = (raw.campaign_slug ?? "").trim() || opts.defaultCampaignSlug;
  const memory_key = required(raw.memory_key ?? "", "memory_key");
  const character = required(raw.character ?? "", "character");
  const summary = required(raw.summary ?? "", "summary");
  const details = (raw.details ?? "").trim();
  const tags = splitList(raw.tags ?? "");
  const source_ids = splitList(raw.source_ids ?? "");
  const gravity = parseMetric(raw.gravity ?? "", 1, "gravity", opts.strict);
  const certainty = parseMetric(raw.certainty ?? "", 1, "certainty", opts.strict);
  const resilience = parseMetric(raw.resilience ?? "", 1, "resilience", opts.strict);
  const status = (raw.status ?? "").trim() || "active";

  return {
    guild_id,
    campaign_slug,
    memory_key,
    character,
    summary,
    details,
    tags,
    source_ids,
    gravity,
    certainty,
    resilience,
    status,
  };
}

export function normalizeGoldCandidateCsvRecord(
  raw: Record<string, string>,
  opts: { strict: boolean; defaultGuildId: string; defaultCampaignSlug: string; defaultSessionId?: string | null },
): GoldCandidateCsvRow {
  const guild_id = (raw.guild_id ?? "").trim() || opts.defaultGuildId;
  const campaign_slug = (raw.campaign_slug ?? "").trim() || opts.defaultCampaignSlug;
  const candidate_key = required(raw.candidate_key ?? raw.memory_key ?? "", "candidate_key");
  const session_id = (raw.session_id ?? "").trim() || opts.defaultSessionId || null;
  const character = required(raw.character ?? "", "character");
  const summary = required(raw.summary ?? "", "summary");
  const details = (raw.details ?? "").trim();
  const tags = splitList(raw.tags ?? "");
  const source_ids = splitList(raw.source_ids ?? "");
  const gravity = parseMetric(raw.gravity ?? "", 1, "gravity", opts.strict);
  const certainty = parseMetric(raw.certainty ?? "", 1, "certainty", opts.strict);
  const resilience = parseMetric(raw.resilience ?? "", 1, "resilience", opts.strict);
  const status = (raw.status ?? "").trim() || "pending";

  return {
    guild_id,
    campaign_slug,
    candidate_key,
    session_id,
    character,
    summary,
    details,
    tags,
    source_ids,
    gravity,
    certainty,
    resilience,
    status,
  };
}

export function serializeGoldMemoryCsvRow(row: GoldMemoryCsvRow): Record<string, string> {
  return {
    guild_id: row.guild_id,
    campaign_slug: row.campaign_slug,
    memory_key: row.memory_key,
    character: row.character,
    summary: row.summary,
    details: row.details,
    tags: row.tags.slice().sort((a, b) => a.localeCompare(b)).join("|"),
    source_ids: row.source_ids.slice().sort((a, b) => a.localeCompare(b)).join("|"),
    gravity: row.gravity.toFixed(3),
    certainty: row.certainty.toFixed(3),
    resilience: row.resilience.toFixed(3),
    status: row.status,
  };
}

export function serializeGoldCandidateCsvRow(row: GoldCandidateCsvRow): Record<string, string> {
  return {
    guild_id: row.guild_id,
    campaign_slug: row.campaign_slug,
    candidate_key: row.candidate_key,
    session_id: row.session_id ?? "",
    character: row.character,
    summary: row.summary,
    details: row.details,
    tags: row.tags.slice().sort((a, b) => a.localeCompare(b)).join("|"),
    source_ids: row.source_ids.slice().sort((a, b) => a.localeCompare(b)).join("|"),
    gravity: row.gravity.toFixed(3),
    certainty: row.certainty.toFixed(3),
    resilience: row.resilience.toFixed(3),
    status: row.status,
  };
}
