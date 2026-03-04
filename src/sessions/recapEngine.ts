import { createHash } from "node:crypto";
import fs from "node:fs";
import { cfg } from "../config/env.js";
import { chat } from "../llm/client.js";
import { buildTranscript } from "../ledger/transcripts.js";
import type { TranscriptEntry } from "../ledger/transcripts.js";
import { getDbForCampaign } from "../db.js";
import { resolveCampaignSlug } from "../campaign/guildConfig.js";
import { getSessionArtifact, getSessionById, upsertSessionArtifact } from "./sessions.js";
import { orchestrateMegaMeecap } from "../tools/megameecap/orchestrate.js";
import { runFinalPassOnly } from "../tools/megameecap/orchestrate.js";
import type { FinalStyle, LlmCall, TranscriptLine } from "../tools/megameecap/types.js";
import { segmentTranscript } from "../silver/seq/segmentTranscript.js";
import type { Segment as MegameecapSegment } from "../tools/megameecap/types.js";
import {
  getBaseStatus,
  getFinalStatus,
  readMegameecapBaseText,
  readMegameecapFinalText,
  resolveMegameecapBasePaths,
  resolveMegameecapFinalPaths,
  type RecapPassStrategy,
} from "./megameecapArtifactLocator.js";

const MEGAMEECAP_ENGINE = "megameecap";
const MEGAMEECAP_BASE_VERSION = "megameecap-base-v1";
const MEGAMEECAP_FINAL_VERSION = "megameecap-final-v1";
const RECAP_LLM_MAX_TOKENS = 1600;
const RECAP_CONTINUATION_MAX_TOKENS = 1000;
const SILVER_TARGET_NARRATIVE_LINES = 250;
const SILVER_MIN_NARRATIVE_LINES = 200;
const SILVER_MAX_NARRATIVE_LINES = 313;
const SILVER_SNAP_WINDOW = 25;

export type RecapStrategy = RecapPassStrategy;

export type RecapResult = {
  text: string;
  createdAtMs: number;
  strategy: RecapStrategy;
  engine: "megameecap";
  strategyVersion: string;
  baseVersion: string;
  finalVersion: string;
  sourceTranscriptHash: string;
  cacheHit: boolean;
  artifactPaths: {
    recapPath: string;
    metaPath: string;
  };
  sourceRange?: {
    startLine: number;
    endLine: number;
    lineCount: number;
  };
};

export type GenerateSessionRecapArgs = {
  guildId: string;
  sessionId: string;
  force?: boolean;
  strategy?: RecapStrategy;
  debug?: boolean;
};

export type BaseEnsureResult = {
  baselineMarkdown: string;
  baseSourceHash: string;
  baseVersion: string;
  basePaths: {
    basePath: string;
    metaPath: string;
  };
  cacheHit: boolean;
};

export type FinalFromBaseResult = {
  text: string;
  createdAtMs: number;
  finalStyle: RecapStrategy;
  sourceHash: string;
  finalVersion: string;
  outputPathMd: string;
  outputPathMetaJson: string;
  cacheHit: boolean;
};

function hashTranscript(lines: TranscriptLine[]): string {
  const stablePayload = lines.map((line) => ({
    lineIndex: line.lineIndex,
    speaker: line.speaker ?? null,
    text: line.text,
  }));

  return createHash("sha256").update(JSON.stringify(stablePayload), "utf8").digest("hex");
}

function looksLikeIncompleteRecap(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (trimmed.length < 120) return false;
  return !/[.!?)]$/.test(trimmed);
}

function buildSilverSegmentsForMegameecap(args: {
  transcriptEntries: TranscriptEntry[];
  lines: TranscriptLine[];
}): MegameecapSegment[] {
  const segmented = segmentTranscript({
    lines: args.transcriptEntries,
    targetNarrativeLines: SILVER_TARGET_NARRATIVE_LINES,
    minNarrativeLines: SILVER_MIN_NARRATIVE_LINES,
    maxNarrativeLines: SILVER_MAX_NARRATIVE_LINES,
    snapWindow: SILVER_SNAP_WINDOW,
    combatMode: "prune",
  });

  const out: MegameecapSegment[] = [];
  for (const segment of segmented.segments) {
    const segmentLines = args.lines.slice(segment.startLineIndex, segment.endLineIndex + 1);
    if (segmentLines.length === 0) continue;
    out.push({
      segmentId: segment.id,
      startLine: segmentLines[0]?.lineIndex ?? segment.startLineIndex,
      endLine: segmentLines[segmentLines.length - 1]?.lineIndex ?? segment.endLineIndex,
      lines: segmentLines,
    });
  }

  return out;
}

export async function generateSessionRecap(
  args: GenerateSessionRecapArgs,
  deps?: { callLlm?: LlmCall; now?: () => number }
): Promise<RecapResult> {
  const strategy = args.strategy ?? "balanced";

  const campaignSlug = resolveCampaignSlug({ guildId: args.guildId });
  const db = getDbForCampaign(campaignSlug);
  const session = getSessionById(args.guildId, args.sessionId);
  if (!session) {
    throw new Error(`Session not found: ${args.sessionId}`);
  }

  const transcript = buildTranscript(args.sessionId, { view: "auto", primaryOnly: true }, db);
  if (transcript.length === 0) {
    throw new Error(`No transcript lines found for session ${args.sessionId}`);
  }

  const lines: TranscriptLine[] = transcript.map((line) => ({
    lineIndex: line.line_index,
    speaker: line.author_name,
    text: line.content,
  }));

  const llmCall: LlmCall =
    deps?.callLlm ??
    (async (input) =>
      chat({
        systemPrompt: input.systemPrompt,
        userMessage: input.userPrompt,
        model: input.model,
        maxTokens: input.maxTokens ?? RECAP_LLM_MAX_TOKENS,
      }));

  const now = deps?.now ?? Date.now;

  const base = await ensureMegameecapBase(
    {
      guildId: args.guildId,
      sessionId: args.sessionId,
      forceBase: args.force ?? false,
    },
    {
      lines,
      transcriptEntries: transcript,
      campaignSlug,
      sessionLabel: session.label ?? args.sessionId,
      callLlm: llmCall,
      now,
    }
  );

  const final = await generateFinalRecapFromBase(
    {
      guildId: args.guildId,
      sessionId: args.sessionId,
      style: strategy,
      forceFinal: args.force ?? false,
    },
    {
      baselineMarkdown: base.baselineMarkdown,
      baseSourceHash: base.baseSourceHash,
      baseVersion: base.baseVersion,
      campaignSlug,
      sessionLabel: session.label ?? args.sessionId,
      callLlm: llmCall,
      now,
    }
  );

  const metaPayload = {
    engine: MEGAMEECAP_ENGINE,
    final_style: strategy,
    source_hash: final.sourceHash,
    base_version: base.baseVersion,
    final_version: final.finalVersion,
    created_at_ms: final.createdAtMs,
    artifact_path_md: final.outputPathMd,
    artifact_path_meta_json: final.outputPathMetaJson,
    source_range: {
      startLine: lines[0]?.lineIndex ?? 0,
      endLine: lines[lines.length - 1]?.lineIndex ?? 0,
      lineCount: lines.length,
    },
  };

  upsertSessionArtifact({
    guildId: args.guildId,
    sessionId: args.sessionId,
    artifactType: "recap_final",
    strategy,
    createdAtMs: final.createdAtMs,
    engine: MEGAMEECAP_ENGINE,
    sourceHash: final.sourceHash,
    strategyVersion: MEGAMEECAP_FINAL_VERSION,
    metaJson: JSON.stringify(metaPayload),
    contentText: final.text,
    filePath: final.outputPathMd,
    sizeBytes: Buffer.byteLength(final.text, "utf8"),
  });

  return {
    text: final.text,
    createdAtMs: final.createdAtMs,
    strategy,
    engine: "megameecap",
    strategyVersion: MEGAMEECAP_FINAL_VERSION,
    baseVersion: MEGAMEECAP_BASE_VERSION,
    finalVersion: MEGAMEECAP_FINAL_VERSION,
    sourceTranscriptHash: final.sourceHash,
    cacheHit: final.cacheHit,
    artifactPaths: {
      recapPath: final.outputPathMd,
      metaPath: final.outputPathMetaJson,
    },
    sourceRange: {
      startLine: lines[0]?.lineIndex ?? 0,
      endLine: lines[lines.length - 1]?.lineIndex ?? 0,
      lineCount: lines.length,
    },
  };
}

export async function ensureMegameecapBase(
  args: { guildId: string; sessionId: string; forceBase?: boolean },
  deps: {
    lines: TranscriptLine[];
    transcriptEntries: TranscriptEntry[];
    campaignSlug: string;
    sessionLabel: string;
    callLlm: LlmCall;
    now: () => number;
  }
): Promise<BaseEnsureResult> {
  const sourceHash = hashTranscript(deps.lines);
  const paths = resolveMegameecapBasePaths(deps.campaignSlug, args.sessionId, deps.sessionLabel);
  const baseStatus = getBaseStatus(deps.campaignSlug, args.sessionId, deps.sessionLabel);
  const hashMatches = baseStatus.sourceHash === sourceHash;
  const versionMatches = baseStatus.baseVersion === MEGAMEECAP_BASE_VERSION;
  const baseDbArtifact = getSessionArtifact(args.guildId, args.sessionId, "megameecap_base");

  const useCache = !args.forceBase && baseStatus.exists && hashMatches && versionMatches;
  if (useCache) {
    const baselineMarkdown = readMegameecapBaseText(paths) ?? "";
    if (baselineMarkdown.length > 0) {
      if (!baseDbArtifact) {
        upsertSessionArtifact({
          guildId: args.guildId,
          sessionId: args.sessionId,
          artifactType: "megameecap_base",
          createdAtMs: baseStatus.createdAtMs ?? deps.now(),
          engine: MEGAMEECAP_ENGINE,
          sourceHash,
          strategy: "base",
          strategyVersion: MEGAMEECAP_BASE_VERSION,
          metaJson: JSON.stringify({
            source_hash: sourceHash,
            base_version: MEGAMEECAP_BASE_VERSION,
            created_at_ms: baseStatus.createdAtMs ?? deps.now(),
            artifact_path_md: paths.basePath,
            artifact_path_meta_json: paths.metaPath,
          }),
          contentText: baselineMarkdown,
          filePath: paths.basePath,
          sizeBytes: Buffer.byteLength(baselineMarkdown, "utf8"),
        });
      }

      return {
        baselineMarkdown,
        baseSourceHash: sourceHash,
        baseVersion: MEGAMEECAP_BASE_VERSION,
        basePaths: {
          basePath: paths.basePath,
          metaPath: paths.metaPath,
        },
        cacheHit: true,
      };
    }
  }

  const output = await orchestrateMegaMeecap(
    {
      sessionLabel: deps.sessionLabel,
      campaign: deps.campaignSlug,
      segmentSize: SILVER_TARGET_NARRATIVE_LINES,
      maxLlmLines: SILVER_MAX_NARRATIVE_LINES,
      segments: buildSilverSegmentsForMegameecap({
        transcriptEntries: deps.transcriptEntries,
        lines: deps.lines,
      }),
      carryConfig: {
        maxCarryChars: 8000,
        maxCarrySegments: 3,
      },
      style: "balanced",
      noFinalPass: true,
      model: cfg.llm.model,
      lines: deps.lines,
    },
    { callLlm: deps.callLlm }
  );

  const createdAtMs = deps.now();
  const baseMeta = {
    engine: MEGAMEECAP_ENGINE,
    source_hash: sourceHash,
    base_version: MEGAMEECAP_BASE_VERSION,
    created_at_ms: createdAtMs,
    artifact_path_md: paths.basePath,
    artifact_path_meta_json: paths.metaPath,
  };

  fs.writeFileSync(paths.basePath, output.baselineMarkdown, "utf8");
  fs.writeFileSync(paths.metaPath, JSON.stringify(baseMeta, null, 2), "utf8");

  upsertSessionArtifact({
    guildId: args.guildId,
    sessionId: args.sessionId,
    artifactType: "megameecap_base",
    createdAtMs,
    engine: MEGAMEECAP_ENGINE,
    sourceHash,
    strategy: "base",
    strategyVersion: MEGAMEECAP_BASE_VERSION,
    metaJson: JSON.stringify(baseMeta),
    contentText: output.baselineMarkdown,
    filePath: paths.basePath,
    sizeBytes: Buffer.byteLength(output.baselineMarkdown, "utf8"),
  });

  return {
    baselineMarkdown: output.baselineMarkdown,
    baseSourceHash: sourceHash,
    baseVersion: MEGAMEECAP_BASE_VERSION,
    basePaths: {
      basePath: paths.basePath,
      metaPath: paths.metaPath,
    },
    cacheHit: false,
  };
}

export async function generateFinalRecapFromBase(
  args: {
    guildId: string;
    sessionId: string;
    style: RecapStrategy;
    forceFinal?: boolean;
  },
  deps: {
    baselineMarkdown: string;
    baseSourceHash: string;
    baseVersion: string;
    campaignSlug: string;
    sessionLabel: string;
    callLlm: LlmCall;
    now: () => number;
  }
): Promise<FinalFromBaseResult> {
  const existingFinal = getSessionArtifact(args.guildId, args.sessionId, "recap_final");
  const expectedPaths = resolveMegameecapFinalPaths(
    deps.campaignSlug,
    args.sessionId,
    args.style,
    deps.sessionLabel
  );
  const finalFileStatus = getFinalStatus(
    deps.campaignSlug,
    args.sessionId,
    args.style,
    deps.sessionLabel
  );
  const hashMatches = existingFinal?.source_hash === deps.baseSourceHash;
  const styleMatches = (existingFinal?.strategy ?? "") === args.style;
  const versionMatches = existingFinal?.strategy_version === MEGAMEECAP_FINAL_VERSION;

  const useCache =
    !args.forceFinal &&
    Boolean(existingFinal) &&
    finalFileStatus.exists &&
    hashMatches &&
    styleMatches &&
    versionMatches;

  if (useCache) {
    const cachedText = readMegameecapFinalText(expectedPaths) ?? existingFinal?.content_text ?? "";
    if (cachedText.length > 0 && !looksLikeIncompleteRecap(cachedText)) {
      return {
        text: cachedText,
        createdAtMs: existingFinal?.created_at_ms ?? deps.now(),
        finalStyle: args.style,
        sourceHash: deps.baseSourceHash,
        finalVersion: MEGAMEECAP_FINAL_VERSION,
        outputPathMd: expectedPaths.recapPath,
        outputPathMetaJson: expectedPaths.metaPath,
        cacheHit: true,
      };
    }
  }

  const final = await runFinalPassOnly({
    baselineMarkdown: deps.baselineMarkdown,
    style: args.style as FinalStyle,
    model: cfg.llm.model,
    callLlm: deps.callLlm,
  });

  let finalMarkdown = final.finalMarkdown;
  if (looksLikeIncompleteRecap(finalMarkdown)) {
    const continuation = await deps.callLlm({
      systemPrompt:
        "Continue the recap from exactly where it stops. Keep the same style/tone and do not repeat prior text.",
      userPrompt: [
        "Current partial recap:",
        finalMarkdown,
        "",
        "Write ONLY the continuation text, starting immediately after the final words above.",
      ].join("\n"),
      model: cfg.llm.model,
      maxTokens: RECAP_CONTINUATION_MAX_TOKENS,
    });
    const continuationTrimmed = continuation.trim();
    if (continuationTrimmed.length > 0) {
      finalMarkdown = `${finalMarkdown.trimEnd()} ${continuationTrimmed}`;
    }
  }

  const createdAtMs = deps.now();
  const finalMeta = {
    engine: MEGAMEECAP_ENGINE,
    final_style: args.style,
    source_hash: deps.baseSourceHash,
    base_version: deps.baseVersion,
    final_version: MEGAMEECAP_FINAL_VERSION,
    created_at_ms: createdAtMs,
    artifact_path_md: expectedPaths.recapPath,
    artifact_path_meta_json: expectedPaths.metaPath,
  };

  fs.writeFileSync(expectedPaths.recapPath, finalMarkdown, "utf8");
  fs.writeFileSync(expectedPaths.metaPath, JSON.stringify(finalMeta, null, 2), "utf8");

  return {
    text: finalMarkdown,
    createdAtMs,
    finalStyle: args.style,
    sourceHash: deps.baseSourceHash,
    finalVersion: MEGAMEECAP_FINAL_VERSION,
    outputPathMd: expectedPaths.recapPath,
    outputPathMetaJson: expectedPaths.metaPath,
    cacheHit: false,
  };
}
