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

function sanitizeCampaignScopeToken(input?: string | null, fallback = "none"): string {
  const normalized = (input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

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

export function buildCampaignScopeDirName(args: {
  guildId: string;
  campaignSlug: string;
}): string {
  const guildToken = sanitizeCampaignScopeToken(args.guildId, "none");
  const campaignToken = sanitizeCampaignScopeToken(args.campaignSlug, DEFAULT_CAMPAIGN_SLUG);
  return `g_${guildToken}__c_${campaignToken}`;
}

function resolveLegacyCampaignDataRoot(campaignSlug: string): string {
  const slug = sanitizeCampaignSlug(campaignSlug);
  return path.join(getDataRoot(), cfg.data.campaignsDir, slug);
}

export function resolveCampaignDataRoot(campaignSlug: string, guildId?: string | null): string {
  const slug = sanitizeCampaignSlug(campaignSlug);
  const normalizedGuildId = guildId?.trim();

  if (!normalizedGuildId) {
    return resolveLegacyCampaignDataRoot(slug);
  }

  return path.join(
    getDataRoot(),
    cfg.data.campaignsDir,
    buildCampaignScopeDirName({ guildId: normalizedGuildId, campaignSlug: slug })
  );
}

export function resolveCampaignDbPath(campaignSlug: string, guildId?: string | null): string {
  const canonical = path.join(resolveCampaignDataRoot(campaignSlug, guildId), cfg.db.filename);
  const legacy = path.join(resolveLegacyCampaignDataRoot(campaignSlug), cfg.db.filename);
  return resolveWithLegacyReadFallback("campaign_db", canonical, legacy, { forWrite: false, ensureExists: false });
}

export function resolveCampaignRunsDir(campaignSlug: string, opts: ResolveOptions = {}, guildId?: string | null): string {
  const canonical = path.join(resolveCampaignDataRoot(campaignSlug, guildId), "runs");
  const legacy = path.resolve("runs");
  return resolveWithLegacyReadFallback("runs", canonical, legacy, opts);
}

export function resolveCampaignTranscriptsDir(campaignSlug: string, opts: ResolveOptions = {}, guildId?: string | null): string {
  const canonical = path.join(resolveCampaignDataRoot(campaignSlug, guildId), "transcripts");
  const legacy = path.join(getDataRoot(), "transcripts");
  return resolveWithLegacyReadFallback("transcripts", canonical, legacy, opts);
}

export function resolveCampaignExportsDir(campaignSlug: string, opts: ResolveOptions = {}, guildId?: string | null): string {
  const canonical = path.join(resolveCampaignDataRoot(campaignSlug, guildId), "exports");
  const legacy = path.join(getDataRoot(), "exports");
  return resolveWithLegacyReadFallback("exports", canonical, legacy, opts);
}

export function resolveCampaignExportSubdir(
  campaignSlug: string,
  subdir: "events" | "meecaps" | "gold" | "transcripts",
  opts: ResolveOptions = {},
  guildId?: string | null,
): string {
  const canonical = path.join(resolveCampaignExportsDir(campaignSlug, opts, guildId), subdir);
  const legacy = path.join(getDataRoot(), subdir);
  return resolveWithLegacyReadFallback(`exports/${subdir}`, canonical, legacy, opts);
}

export function resolveCampaignTranscriptExportsDir(
  campaignSlug: string,
  lane: "online" | "offline_replay" = "online",
  opts: ResolveOptions = {},
  guildId?: string | null,
): string {
  const transcriptsRoot = resolveCampaignExportSubdir(campaignSlug, "transcripts", opts, guildId);
  const canonical = path.join(transcriptsRoot, lane);
  return ensureDirIfRequested(canonical, opts.ensureExists ?? opts.forWrite ?? false);
}

function sanitizeSessionLabelForFilename(sessionLabel: string): string {
  const trimmed = sessionLabel.trim();
  if (!trimmed) return "";
  return trimmed
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function sanitizeArtifactToken(value: string | null | undefined, fallback: string): string {
  const safe = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return safe.length > 0 ? safe : fallback;
}

function sanitizeFileToken(value: string): string {
  const safe = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return safe.length > 0 ? safe : "na";
}

export function buildLegacySessionArtifactStem(sessionId: string, sessionLabel?: string | null): string {
  const safeLabel = sessionLabel ? sanitizeSessionLabelForFilename(sessionLabel) : "";
  const identity = safeLabel.length > 0 ? safeLabel : sessionId;
  return `session-${identity}`;
}

export function buildSessionArtifactStem(args: {
  guildId: string;
  campaignSlug?: string | null;
  sessionId: string;
}): string {
  const guildToken = sanitizeArtifactToken(args.guildId, "none");
  const campaignToken = sanitizeArtifactToken(args.campaignSlug ?? null, "none");
  const sessionToken = sanitizeArtifactToken(args.sessionId, "none");
  return `g_${guildToken}__c_${campaignToken}__s_${sessionToken}`;
}

export function resolveSessionMegameecapPaths(args: {
  guildId: string;
  campaignSlug: string;
  sessionId: string;
  sessionLabel?: string | null;
  finalStyle?: "detailed" | "balanced" | "concise";
  chunk?: {
    chunkIndex: number;
    rangeStartLedgerId: string;
    rangeEndLedgerId: string;
    algoVersion: string;
  };
}): {
  outputDir: string;
  basePath: string;
  baseMetaPath: string;
  finalPath: string;
  finalMetaPath: string;
  chunkPath: string | null;
  chunkMetaPath: string | null;
} {
  const replayArtifactOverride = process.env.MEEPO_HEARTBEAT_REPLAY_ARTIFACT_DIR?.trim();
  const outputDir = replayArtifactOverride
    ? ensureDirIfRequested(path.resolve(replayArtifactOverride), true)
    : resolveCampaignExportSubdir(args.campaignSlug, "meecaps", {
        forWrite: true,
        ensureExists: true,
      }, args.guildId);
  const stem = buildSessionArtifactStem({
    guildId: args.guildId,
    campaignSlug: args.campaignSlug,
    sessionId: args.sessionId,
  });
  const finalStyle = args.finalStyle ?? "balanced";
  const baseName = `${stem}-megameecap-base`;
  const finalName = `${stem}-recap-final-${finalStyle}`;

  let chunkPath: string | null = null;
  let chunkMetaPath: string | null = null;
  if (args.chunk) {
    const chunkIndex = String(Math.max(1, Math.trunc(args.chunk.chunkIndex))).padStart(4, "0");
    const chunkName = [
      `${stem}-megameecap-chunk-${chunkIndex}`,
      sanitizeFileToken(args.chunk.rangeStartLedgerId),
      sanitizeFileToken(args.chunk.rangeEndLedgerId),
      sanitizeFileToken(args.chunk.algoVersion),
    ].join("-");
    chunkPath = path.join(outputDir, `${chunkName}.md`);
    chunkMetaPath = path.join(outputDir, `${chunkName}.meta.json`);
  }

  return {
    outputDir,
    basePath: path.join(outputDir, `${baseName}.md`),
    baseMetaPath: path.join(outputDir, `${baseName}.meta.json`),
    finalPath: path.join(outputDir, `${finalName}.md`),
    finalMetaPath: path.join(outputDir, `${finalName}.meta.json`),
    chunkPath,
    chunkMetaPath,
  };
}

export function resolveCampaignCacheDir(campaignSlug: string, opts: ResolveOptions = {}, guildId?: string | null): string {
  const canonical = path.join(resolveCampaignDataRoot(campaignSlug, guildId), "cache");
  const legacy = path.join(getDataRoot(), "cache");
  return resolveWithLegacyReadFallback("cache", canonical, legacy, opts);
}

export function resolveCampaignPidPath(campaignSlug: string, guildId?: string | null): string {
  return path.join(resolveCampaignCacheDir(campaignSlug, { forWrite: true, ensureExists: true }, guildId), "bot.pid");
}
