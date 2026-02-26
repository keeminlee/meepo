import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { getDefaultCampaignSlug } from "../../campaign/defaultCampaign.js";
import { getEnv } from "../../config/rawEnv.js";
import { getDbForCampaign } from "../../db.js";
import { buildTranscript } from "../../ledger/transcripts.js";
import { chat } from "../../llm/client.js";
import {
  baselineFilename,
  finalFilename,
  metaFilename,
  readBaselineInput,
  resolveMegameecapOutputDir,
  writeMegameecapOutputs,
} from "./io.js";
import { orchestrateMegaMeecap, runFinalPassOnly } from "./orchestrate.js";
import type { FinalStyle, MegaMeecapMeta, TranscriptLine } from "./types.js";

type Args = {
  session: string;
  campaign: string;
  segmentSize: number;
  maxLlmLines: number;
  maxCarryChars: number;
  maxCarrySegments: number;
  style: FinalStyle;
  model: string;
  noFinalPass: boolean;
  finalOnly: boolean;
  inputPath: string | null;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);

  let session = "";
  let campaign = getDefaultCampaignSlug();
  let segmentSize = 250;
  let maxLlmLines = 200;
  let maxCarryChars = 12000;
  let maxCarrySegments = 3;
  let style: FinalStyle = "balanced";
  let model = getEnv("LLM_MODEL", "gpt-4o-mini") ?? "gpt-4o-mini";
  let noFinalPass = false;
  let finalOnly = false;
  let inputPath: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--session" && argv[i + 1]) {
      session = argv[++i];
    } else if (arg === "--campaign" && argv[i + 1]) {
      campaign = argv[++i];
    } else if (arg === "--segment_size" && argv[i + 1]) {
      segmentSize = Number(argv[++i]);
    } else if (arg === "--max_llm_lines" && argv[i + 1]) {
      maxLlmLines = Number(argv[++i]);
    } else if (arg === "--max_carry_chars" && argv[i + 1]) {
      maxCarryChars = Number(argv[++i]);
    } else if (arg === "--max_carry_segments" && argv[i + 1]) {
      maxCarrySegments = Number(argv[++i]);
    } else if (arg === "--style" && argv[i + 1]) {
      const value = argv[++i] as FinalStyle;
      if (value === "detailed" || value === "balanced" || value === "concise") {
        style = value;
      } else {
        throw new Error(`Invalid --style '${value}'. Expected detailed|balanced|concise.`);
      }
    } else if (arg === "--model" && argv[i + 1]) {
      model = argv[++i];
    } else if (arg === "--no_final_pass") {
      noFinalPass = true;
    } else if (arg === "--final_only") {
      finalOnly = true;
    } else if (arg === "--input" && argv[i + 1]) {
      inputPath = argv[++i];
    }
  }

  if (!session) {
    throw new Error("Missing required argument: --session <SESSION_LABEL>");
  }

  if (finalOnly && !inputPath) {
    throw new Error("--final_only requires --input <baseline_markdown_path>");
  }

  if (finalOnly && noFinalPass) {
    throw new Error("Cannot combine --final_only with --no_final_pass");
  }

  return {
    session,
    campaign,
    segmentSize: Math.max(1, Math.floor(segmentSize)),
    maxLlmLines: Math.max(1, Math.floor(maxLlmLines)),
    maxCarryChars: Math.max(0, Math.floor(maxCarryChars)),
    maxCarrySegments: Math.max(0, Math.floor(maxCarrySegments)),
    style,
    model,
    noFinalPass,
    finalOnly,
    inputPath,
  };
}

function resolveSession(db: any, sessionLabel: string): { session_id: string; label: string } {
  const row = db
    .prepare(
      `SELECT session_id, label
       FROM sessions
       WHERE label = ?
       ORDER BY created_at_ms DESC
       LIMIT 1`,
    )
    .get(sessionLabel) as { session_id: string; label: string } | undefined;

  if (!row) {
    throw new Error(`Session not found: ${sessionLabel}`);
  }

  return row;
}

function toTranscriptLines(rows: Array<{ line_index: number; author_name: string; content: string }>): TranscriptLine[] {
  return rows.map((row) => ({
    lineIndex: row.line_index,
    speaker: row.author_name,
    text: row.content,
  }));
}

function readPriorMeta(campaign: string, session: string): MegaMeecapMeta | null {
  const outputDir = resolveMegameecapOutputDir(campaign);
  const metaPath = path.join(outputDir, metaFilename(session));
  if (!fs.existsSync(metaPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    if (typeof parsed === "object" && parsed) {
      return parsed as MegaMeecapMeta;
    }
  } catch {
    return null;
  }

  return null;
}

async function main(): Promise<void> {
  const args = parseArgs();

  const callLlm = async (input: { systemPrompt: string; userPrompt: string; model: string }) => {
    return chat({
      systemPrompt: input.systemPrompt,
      userMessage: input.userPrompt,
      model: input.model,
      maxTokens: 16000,
    });
  };

  const outputDir = resolveMegameecapOutputDir(args.campaign);
  const baselinePath = path.join(outputDir, baselineFilename(args.session));
  const shouldReuseExistingBaseline =
    !args.finalOnly &&
    !args.noFinalPass &&
    fs.existsSync(baselinePath);

  if (shouldReuseExistingBaseline) {
    console.log(`[megameecap-v1] Reusing existing baseline: ${baselinePath}`);

    const baselineMarkdown = readBaselineInput(baselinePath);
    const final = await runFinalPassOnly({
      baselineMarkdown,
      style: args.style,
      model: args.model,
      callLlm,
    });

    const previousMeta = readPriorMeta(args.campaign, args.session);
    const generatedAt = new Date().toISOString();
    const meta: MegaMeecapMeta = {
      session: args.session,
      campaign: args.campaign,
      generated_at: generatedAt,
      model: args.model,
      segment_count: previousMeta?.segment_count ?? 0,
      segment_size: previousMeta?.segment_size ?? args.segmentSize,
      total_input_lines: previousMeta?.total_input_lines ?? 0,
      total_output_chars: (previousMeta?.total_output_chars ?? 0) + final.finalMarkdown.length,
      final_style: args.style,
      timing: {
        segment_calls_ms: previousMeta?.timing.segment_calls_ms ?? [],
        final_pass_ms: final.finalPassMs,
      },
    };

    const output = writeMegameecapOutputs({
      campaignSlug: args.campaign,
      sessionLabel: args.session,
      baselineMarkdown,
      finalMarkdown: final.finalMarkdown,
      finalStyle: args.style,
      meta,
    });

    console.log(`\n✅ Reused baseline: ${baselinePath}`);
    console.log(`✅ Final-only MegaMeecap written: ${output.finalPath}`);
    console.log(`✅ Meta written: ${output.metaPath}`);
    return;
  }

  if (args.finalOnly) {
    const baselineMarkdown = readBaselineInput(args.inputPath!);
    const final = await runFinalPassOnly({
      baselineMarkdown,
      style: args.style,
      model: args.model,
      callLlm,
    });

    const previousMeta = readPriorMeta(args.campaign, args.session);
    const generatedAt = new Date().toISOString();
    const meta: MegaMeecapMeta = {
      session: args.session,
      campaign: args.campaign,
      generated_at: generatedAt,
      model: args.model,
      segment_count: previousMeta?.segment_count ?? 0,
      segment_size: previousMeta?.segment_size ?? args.segmentSize,
      total_input_lines: previousMeta?.total_input_lines ?? 0,
      total_output_chars: (previousMeta?.total_output_chars ?? 0) + final.finalMarkdown.length,
      final_style: args.style,
      timing: {
        segment_calls_ms: previousMeta?.timing.segment_calls_ms ?? [],
        final_pass_ms: final.finalPassMs,
      },
    };

    const output = writeMegameecapOutputs({
      campaignSlug: args.campaign,
      sessionLabel: args.session,
      baselineMarkdown,
      finalMarkdown: final.finalMarkdown,
      finalStyle: args.style,
      meta,
    });

    console.log(`\n✅ Final-only MegaMeecap written: ${output.finalPath}`);
    console.log(`✅ Meta written: ${output.metaPath}`);
    return;
  }

  const db = getDbForCampaign(args.campaign);
  const session = resolveSession(db, args.session);
  const transcript = buildTranscript(session.session_id, { view: "bronze", primaryOnly: true }, db);

  if (transcript.length === 0) {
    throw new Error(`No bronze transcript lines found for session ${session.label}`);
  }

  const lines = toTranscriptLines(transcript);

  const result = await orchestrateMegaMeecap(
    {
      sessionLabel: session.label,
      campaign: args.campaign,
      segmentSize: args.segmentSize,
      maxLlmLines: args.maxLlmLines,
      carryConfig: {
        maxCarryChars: args.maxCarryChars,
        maxCarrySegments: args.maxCarrySegments,
      },
      style: args.style,
      noFinalPass: args.noFinalPass,
      model: args.model,
      lines,
    },
    { callLlm },
  );

  const output = writeMegameecapOutputs({
    campaignSlug: args.campaign,
    sessionLabel: session.label,
    baselineMarkdown: result.baselineMarkdown,
    finalMarkdown: result.finalMarkdown,
    finalStyle: args.style,
    meta: result.meta,
  });

  console.log(`\n✅ Baseline MegaMeecap written: ${output.baselinePath}`);
  if (output.finalPath) {
    console.log(`✅ Final MegaMeecap written: ${output.finalPath}`);
  }
  console.log(`✅ Meta written: ${output.metaPath}`);
}

main().catch((err) => {
  console.error("❌", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
