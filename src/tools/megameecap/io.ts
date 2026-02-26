import fs from "node:fs";
import path from "node:path";
import { resolveCampaignExportSubdir } from "../../dataPaths.js";
import type { FinalStyle, MegaMeecapMeta } from "./types.js";

export function resolveMegameecapOutputDir(campaignSlug: string): string {
  return resolveCampaignExportSubdir(campaignSlug, "meecaps", {
    forWrite: true,
    ensureExists: true,
  });
}

export function baselineFilename(sessionLabel: string): string {
  return `megameecap_${sessionLabel}.md`;
}

export function finalFilename(sessionLabel: string, style: FinalStyle): string {
  return `megameecap_${sessionLabel}__final_${style}.md`;
}

export function metaFilename(sessionLabel: string): string {
  return `megameecap_${sessionLabel}.meta.json`;
}

export function writeMegameecapOutputs(args: {
  campaignSlug: string;
  sessionLabel: string;
  baselineMarkdown: string;
  finalMarkdown: string | null;
  finalStyle: FinalStyle;
  meta: MegaMeecapMeta;
  outputDirOverride?: string;
}): {
  outputDir: string;
  baselinePath: string;
  finalPath: string | null;
  metaPath: string;
} {
  const outputDir = args.outputDirOverride
    ? path.resolve(args.outputDirOverride)
    : resolveMegameecapOutputDir(args.campaignSlug);
  fs.mkdirSync(outputDir, { recursive: true });
  const baselinePath = path.join(outputDir, baselineFilename(args.sessionLabel));
  const finalPath = args.finalMarkdown
    ? path.join(outputDir, finalFilename(args.sessionLabel, args.finalStyle))
    : null;
  const metaPath = path.join(outputDir, metaFilename(args.sessionLabel));

  fs.writeFileSync(baselinePath, args.baselineMarkdown, "utf-8");
  if (finalPath && args.finalMarkdown) {
    fs.writeFileSync(finalPath, args.finalMarkdown, "utf-8");
  }
  fs.writeFileSync(metaPath, JSON.stringify(args.meta, null, 2), "utf-8");

  return {
    outputDir,
    baselinePath,
    finalPath,
    metaPath,
  };
}

export function readBaselineInput(inputPath: string): string {
  return fs.readFileSync(path.resolve(inputPath), "utf-8");
}
