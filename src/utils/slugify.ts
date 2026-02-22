/**
 * Produce a filesystem-safe, URL-style slug from a display name (e.g. Discord server name).
 * - lower-case
 * - spaces → -
 * - strip non [a-z0-9-]
 * - collapse repeated -
 * - max length cap (48)
 */

const MAX_LENGTH = 48;

export function slugify(name: string): string {
  if (typeof name !== "string") return "";
  let s = name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (s.length > MAX_LENGTH) {
    s = s.slice(0, MAX_LENGTH).replace(/-$/, "");
  }
  return s || "default";
}
