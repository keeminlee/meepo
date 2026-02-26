import fs from "node:fs";
import path from "node:path";
import { cfg } from "./config/env.js";

type ResolveOptions = {
  forWrite?: boolean;
  ensureExists?: boolean;
};

const DEFAULT_CAMPAIGN_SLUG = "default";
const warnedLegacyKinds = new Set<string>();
let legacyFallbacksThisBoot = 0;

function sanitizeCampaignSlug(input?: string | null): string {
  const normalized = (input ?? DEFAULT_CAMPAIGN_SLUG)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  const safe = normalized || DEFAULT_CAMPAIGN_SLUG;
  if (safe.includes("..") || safe.includes("/") || safe.includes("\\")) {
    return DEFAULT_CAMPAIGN_SLUG;
  }
  return safe;
}

function ensureDirIfRequested(dirPath: string, ensureExists?: boolean): string {
  if (ensureExists) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

function warnLegacyFallbackOnce(kind: string, legacyPath: string, canonicalPath: string): void {
  if (warnedLegacyKinds.has(kind)) return;
  warnedLegacyKinds.add(kind);
  legacyFallbacksThisBoot += 1;
  console.warn(
    `[dataPaths] Legacy fallback (${kind}) -> ${legacyPath}. Canonical path is ${canonicalPath}.`
  );
}

function resolveWithLegacyReadFallback(kind: string, canonicalPath: string, legacyPath: string, opts: ResolveOptions = {}): string {
  const forWrite = opts.forWrite ?? false;
  if (forWrite) {
    return ensureDirIfRequested(canonicalPath, opts.ensureExists ?? true);
  }

  if (fs.existsSync(canonicalPath)) {
    return ensureDirIfRequested(canonicalPath, opts.ensureExists ?? false);
  }

  if (fs.existsSync(legacyPath)) {
    warnLegacyFallbackOnce(kind, legacyPath, canonicalPath);
    return ensureDirIfRequested(legacyPath, opts.ensureExists ?? false);
  }

  return ensureDirIfRequested(canonicalPath, opts.ensureExists ?? false);
}

export function getLegacyFallbacksThisBoot(): number {
  return legacyFallbacksThisBoot;
}

export function getDataRoot(): string {
  return path.resolve(cfg.data.root);
}

export function resolveCampaignDataRoot(campaignSlug: string): string {
  const slug = sanitizeCampaignSlug(campaignSlug);
  return path.join(getDataRoot(), cfg.data.campaignsDir, slug);
}

export function resolveCampaignDbPath(campaignSlug: string): string {
  return path.join(resolveCampaignDataRoot(campaignSlug), cfg.db.filename);
}

export function resolveCampaignRunsDir(campaignSlug: string, opts: ResolveOptions = {}): string {
  const canonical = path.join(resolveCampaignDataRoot(campaignSlug), "runs");
  const legacy = path.resolve("runs");
  return resolveWithLegacyReadFallback("runs", canonical, legacy, opts);
}

export function resolveCampaignTranscriptsDir(campaignSlug: string, opts: ResolveOptions = {}): string {
  const canonical = path.join(resolveCampaignDataRoot(campaignSlug), "transcripts");
  const legacy = path.join(getDataRoot(), "transcripts");
  return resolveWithLegacyReadFallback("transcripts", canonical, legacy, opts);
}

export function resolveCampaignExportsDir(campaignSlug: string, opts: ResolveOptions = {}): string {
  const canonical = path.join(resolveCampaignDataRoot(campaignSlug), "exports");
  const legacy = path.join(getDataRoot(), "exports");
  return resolveWithLegacyReadFallback("exports", canonical, legacy, opts);
}

export function resolveCampaignExportSubdir(campaignSlug: string, subdir: "events" | "meecaps" | "gold", opts: ResolveOptions = {}): string {
  const canonical = path.join(resolveCampaignExportsDir(campaignSlug, opts), subdir);
  const legacy = path.join(getDataRoot(), subdir);
  return resolveWithLegacyReadFallback(`exports/${subdir}`, canonical, legacy, opts);
}

export function resolveCampaignCacheDir(campaignSlug: string, opts: ResolveOptions = {}): string {
  const canonical = path.join(resolveCampaignDataRoot(campaignSlug), "cache");
  const legacy = path.join(getDataRoot(), "cache");
  return resolveWithLegacyReadFallback("cache", canonical, legacy, opts);
}

export function resolveCampaignPidPath(campaignSlug: string): string {
  return path.join(resolveCampaignCacheDir(campaignSlug, { forWrite: true, ensureExists: true }), "bot.pid");
}
