const MAX_SCOPE_SLUG_LENGTH = 48;

/**
 * Canonical slug for new meta/showtime campaign scopes.
 * Doctrine: lowercase + underscore separators + deterministic trimming.
 */
export function slugifyCampaignScopeName(name: string): string {
  if (typeof name !== "string") return "default";

  const normalized = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  const clipped = normalized.slice(0, MAX_SCOPE_SLUG_LENGTH).replace(/_+$/g, "");
  return clipped || "default";
}

/**
 * Lookup normalization is permissive for legacy reads and explicit slug targeting.
 */
export function normalizeCampaignSlugLookup(slug: string): string {
  if (typeof slug !== "string") return "";
  return slug
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, "")
    .replace(/_+/g, "_")
    .replace(/-+/g, "-")
    .replace(/^[_-]+|[_-]+$/g, "");
}

export function resolveGuildScopedSlugCollision(baseSlug: string, existingSlugs: Iterable<string>): string {
  const normalizedBase = slugifyCampaignScopeName(baseSlug);
  const occupied = new Set(Array.from(existingSlugs, (slug) => normalizeCampaignSlugLookup(slug)));

  if (!occupied.has(normalizeCampaignSlugLookup(normalizedBase))) {
    return normalizedBase;
  }

  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${normalizedBase}_${suffix}`;
    if (!occupied.has(normalizeCampaignSlugLookup(candidate))) {
      return candidate;
    }
  }

  throw new Error(`Unable to resolve slug collision for base slug: ${normalizedBase}`);
}
