import fs from "node:fs";
import path from "node:path";
import { resolveMegameecapOutputDir } from "../tools/megameecap/io.js";
import { buildSessionArtifactStem } from "../dataPaths.js";

export { buildSessionArtifactStem } from "../dataPaths.js";

export type RecapPassStrategy = "detailed" | "balanced" | "concise";

const KNOWN_FINAL_STRATEGIES: RecapPassStrategy[] = ["detailed", "balanced", "concise"];

export type RecapArtifactPaths = {
  outputDir: string;
  recapPath: string;
  metaPath: string;
};

export type BaseArtifactPaths = {
  outputDir: string;
  basePath: string;
  metaPath: string;
};

export type BaseStatus = {
  exists: boolean;
  sourceHash: string | null;
  baseVersion: string | null;
  createdAtMs: number | null;
  paths: BaseArtifactPaths;
};

export type FinalStatus = {
  exists: boolean;
  style: RecapPassStrategy | null;
  sourceHash: string | null;
  baseVersion: string | null;
  finalVersion: string | null;
  createdAtMs: number | null;
  paths: RecapArtifactPaths | null;
};

function readJsonFile(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf8");
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function resolveMegameecapBasePaths(
  campaignSlug: string,
  sessionId: string,
  sessionLabel?: string | null
): BaseArtifactPaths {
  const outputDir = resolveMegameecapOutputDir(campaignSlug);
  const baseName = `${buildSessionArtifactStem(sessionId, sessionLabel)}-megameecap-base`;
  return {
    outputDir,
    basePath: path.join(outputDir, `${baseName}.md`),
    metaPath: path.join(outputDir, `${baseName}.meta.json`),
  };
}

export function resolveMegameecapFinalPaths(
  campaignSlug: string,
  sessionId: string,
  strategy: RecapPassStrategy,
  sessionLabel?: string | null
): RecapArtifactPaths {
  const outputDir = resolveMegameecapOutputDir(campaignSlug);

  const baseName = `${buildSessionArtifactStem(sessionId, sessionLabel)}-recap-final-${strategy}`;
  return {
    outputDir,
    recapPath: path.join(outputDir, `${baseName}.md`),
    metaPath: path.join(outputDir, `${baseName}.meta.json`),
  };
}

export function resolveMegameecapRecapPaths(
  campaignSlug: string,
  sessionId: string,
  strategy: RecapPassStrategy,
  sessionLabel?: string | null
): RecapArtifactPaths {
  return resolveMegameecapFinalPaths(campaignSlug, sessionId, strategy, sessionLabel);
}

export function getBaseStatus(campaignSlug: string, sessionId: string, sessionLabel?: string | null): BaseStatus {
  const primaryPaths = resolveMegameecapBasePaths(campaignSlug, sessionId, sessionLabel);
  const legacyPaths = resolveMegameecapBasePaths(campaignSlug, sessionId);
  const primaryExists = fs.existsSync(primaryPaths.basePath) && fs.existsSync(primaryPaths.metaPath);
  const legacyExists = fs.existsSync(legacyPaths.basePath) && fs.existsSync(legacyPaths.metaPath);
  const paths = primaryExists ? primaryPaths : legacyExists ? legacyPaths : primaryPaths;
  const hasBase = primaryExists || legacyExists;
  const meta = readJsonFile(paths.metaPath);

  return {
    exists: hasBase,
    sourceHash: typeof meta?.source_hash === "string" ? meta.source_hash : null,
    baseVersion: typeof meta?.base_version === "string" ? meta.base_version : null,
    createdAtMs: typeof meta?.created_at_ms === "number" ? meta.created_at_ms : null,
    paths,
  };
}

export function getFinalStatus(
  campaignSlug: string,
  sessionId: string,
  strategy?: RecapPassStrategy,
  sessionLabel?: string | null
): FinalStatus {
  if (strategy) {
    const primaryPaths = resolveMegameecapFinalPaths(campaignSlug, sessionId, strategy, sessionLabel);
    const legacyPaths = resolveMegameecapFinalPaths(campaignSlug, sessionId, strategy);
    const primaryExists = fs.existsSync(primaryPaths.recapPath) && fs.existsSync(primaryPaths.metaPath);
    const legacyExists = fs.existsSync(legacyPaths.recapPath) && fs.existsSync(legacyPaths.metaPath);
    const paths = primaryExists ? primaryPaths : legacyExists ? legacyPaths : primaryPaths;
    const exists = primaryExists || legacyExists;
    const meta = readJsonFile(paths.metaPath);
    return {
      exists,
      style: strategy,
      sourceHash: typeof meta?.source_hash === "string" ? meta.source_hash : null,
      baseVersion: typeof meta?.base_version === "string" ? meta.base_version : null,
      finalVersion: typeof meta?.final_version === "string" ? meta.final_version : null,
      createdAtMs: typeof meta?.created_at_ms === "number" ? meta.created_at_ms : null,
      paths,
    };
  }

  let best: FinalStatus | null = null;

  for (const style of KNOWN_FINAL_STRATEGIES) {
    const status = getFinalStatus(campaignSlug, sessionId, style, sessionLabel);
    if (!status.exists) continue;
    if (!best || (status.createdAtMs ?? 0) > (best.createdAtMs ?? 0)) {
      best = status;
    }
  }

  return (
    best ?? {
      exists: false,
      style: null,
      sourceHash: null,
      baseVersion: null,
      finalVersion: null,
      createdAtMs: null,
      paths: null,
    }
  );
}

export function getAllFinalStatuses(campaignSlug: string, sessionId: string, sessionLabel?: string | null): FinalStatus[] {
  return KNOWN_FINAL_STRATEGIES.map((style) => getFinalStatus(campaignSlug, sessionId, style, sessionLabel));
}

export function readMegameecapBaseText(paths: BaseArtifactPaths): string | null {
  if (!fs.existsSync(paths.basePath)) return null;
  return fs.readFileSync(paths.basePath, "utf8");
}

export function readMegameecapFinalText(paths: RecapArtifactPaths): string | null {
  if (!fs.existsSync(paths.recapPath)) return null;
  return fs.readFileSync(paths.recapPath, "utf8");
}
