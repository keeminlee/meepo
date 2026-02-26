import { buildCarryBlock, pushCarrySummary } from "./contextCarry.js";
import { buildFinalBalancedPrompt } from "./prompts/finalBalancedPrompt.js";
import { buildFinalConcisePrompt } from "./prompts/finalConcisePrompt.js";
import { buildFinalDetailedPrompt } from "./prompts/finalDetailedPrompt.js";
import { buildSegmentPrompt } from "./prompts/segmentPrompt.js";
import { segmentTranscriptLines } from "./segmenter.js";
import type {
  FinalStyle,
  LlmCall,
  OrchestrateInput,
  OrchestrateOutput,
  Segment,
  SegmentCallLog,
  TranscriptLine,
} from "./types.js";

function formatSegmentLines(lines: TranscriptLine[]): string {
  return lines
    .map((line) => `[L${line.lineIndex}] ${line.speaker ?? "Unknown"}: ${line.text}`)
    .join("\n");
}

function stripSessionRecapSectionIfPresent(segmentOutput: string): { text: string; stripped: boolean } {
  if (!/SESSION\s+RECAP/i.test(segmentOutput)) {
    return { text: segmentOutput.trim(), stripped: false };
  }

  const withoutRecap = segmentOutput
    .replace(/={0,3}\s*SESSION\s+RECAP\s*={0,3}[\s\S]*?(?=(={0,3}\s*NARRATIVE\s*={0,3})|$)/i, "")
    .trim();

  const normalized = withoutRecap.replace(/={0,3}\s*NARRATIVE\s*={0,3}\s*/i, "").trim();
  return {
    text: normalized,
    stripped: true,
  };
}

function buildBaselineMarkdown(args: {
  sessionLabel: string;
  campaign: string;
  generatedAtIso: string;
  segmentSize: number;
  maxCarryChars: number;
  maxCarrySegments: number;
  model: string;
  segments: Array<{ segment: Segment; linesSent: number; content: string }>;
}): string {
  const header = [
    `# MegaMeecap — ${args.sessionLabel}`,
    "",
    `- Campaign: ${args.campaign}`,
    `- Generated: ${args.generatedAtIso}`,
    "- Transcript view: bronze",
    `- Segments: ${args.segments.length}`,
    `- Segment size: ${args.segmentSize}`,
    `- max_carry_segments: ${args.maxCarrySegments}`,
    `- max_carry_chars: ${args.maxCarryChars}`,
    `- Model: ${args.model}`,
    "",
    "---",
  ].join("\n");

  const body = args.segments
    .map(({ segment, linesSent, content }) => {
      const segmentHeader = `## ${segment.segmentId} — Lines ${segment.startLine}–${segment.endLine}`;
      return [
        "",
        `${segmentHeader} (lines=${segment.lines.length}, sent=${linesSent})`,
        content,
        "",
        "---",
      ].join("\n");
    })
    .join("\n");

  return `${header}${body}\n`;
}

function buildFinalPrompt(style: FinalStyle, baselineMarkdown: string) {
  if (style === "detailed") return buildFinalDetailedPrompt(baselineMarkdown);
  if (style === "concise") return buildFinalConcisePrompt(baselineMarkdown);
  return buildFinalBalancedPrompt(baselineMarkdown);
}

export async function orchestrateMegaMeecap(
  input: OrchestrateInput,
  deps: { callLlm: LlmCall },
): Promise<OrchestrateOutput> {
  const segments = segmentTranscriptLines(input.lines, input.segmentSize);
  const segmentLogs: SegmentCallLog[] = [];
  const segmentOutputs: Array<{ segment: Segment; linesSent: number; content: string }> = [];

  let carrySummaries: Array<{ segmentId: string; summary: string }> = [];

  for (const segment of segments) {
    const sentLines = segment.lines.slice(0, Math.max(1, Math.floor(input.maxLlmLines)));
    const transcriptChunk = formatSegmentLines(sentLines);

    const carry = buildCarryBlock(carrySummaries, input.carryConfig);
    const segmentHeader = `## ${segment.segmentId} — Lines ${segment.startLine}–${segment.endLine}`;

    const prompt = buildSegmentPrompt({
      priorContext: carry.text,
      segmentHeader,
      transcriptChunk,
    });

    const reqCharsEstimate = prompt.systemPrompt.length + prompt.userPrompt.length;
    const callStart = Date.now();

    console.log(
      `[megameecap-v1] ${segment.segmentId} range=[${segment.startLine}-${segment.endLine}] lines_total=${segment.lines.length} lines_sent=${sentLines.length} context_chars_used=${carry.usedChars} reqChars~${reqCharsEstimate}`,
    );

    const raw = await deps.callLlm({
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt,
      model: input.model,
    });

    const callMs = Date.now() - callStart;
    const cleaned = stripSessionRecapSectionIfPresent(raw);
    if (cleaned.stripped) {
      console.warn(`[megameecap-v1] ${segment.segmentId}: stripped unexpected SESSION RECAP block from model output.`);
    }

    segmentOutputs.push({
      segment,
      linesSent: sentLines.length,
      content: cleaned.text,
    });

    carrySummaries = pushCarrySummary(carrySummaries, {
      segmentId: segment.segmentId,
      summary: cleaned.text,
    });

    segmentLogs.push({
      segmentId: segment.segmentId,
      startLine: segment.startLine,
      endLine: segment.endLine,
      linesTotal: segment.lines.length,
      linesSent: sentLines.length,
      contextCharsUsed: carry.usedChars,
      reqCharsEstimate,
      respChars: cleaned.text.length,
      durationMs: callMs,
    });

    console.log(`[megameecap-v1] ${segment.segmentId} ms=${callMs} respChars=${cleaned.text.length}`);
  }

  const generatedAtIso = new Date().toISOString();
  const baselineMarkdown = buildBaselineMarkdown({
    sessionLabel: input.sessionLabel,
    campaign: input.campaign,
    generatedAtIso,
    segmentSize: input.segmentSize,
    maxCarryChars: input.carryConfig.maxCarryChars,
    maxCarrySegments: input.carryConfig.maxCarrySegments,
    model: input.model,
    segments: segmentOutputs,
  });

  let finalMarkdown: string | null = null;
  let finalPassMs = 0;

  if (!input.noFinalPass) {
    const finalPrompt = buildFinalPrompt(input.style, baselineMarkdown);
    const start = Date.now();
    finalMarkdown = await deps.callLlm({
      systemPrompt: finalPrompt.systemPrompt,
      userPrompt: finalPrompt.userPrompt,
      model: input.model,
    });
    finalPassMs = Date.now() - start;
    console.log(`[megameecap-v1] final-pass style=${input.style} ms=${finalPassMs} respChars=${finalMarkdown.length}`);
  }

  const totalOutputChars = segmentOutputs.reduce((sum, item) => sum + item.content.length, 0) + (finalMarkdown?.length ?? 0);

  return {
    baselineMarkdown,
    finalMarkdown,
    segmentLogs,
    finalPassMs,
    meta: {
      session: input.sessionLabel,
      campaign: input.campaign,
      generated_at: generatedAtIso,
      model: input.model,
      segment_count: segments.length,
      segment_size: input.segmentSize,
      total_input_lines: input.lines.length,
      total_output_chars: totalOutputChars,
      final_style: input.noFinalPass ? null : input.style,
      timing: {
        segment_calls_ms: segmentLogs.map((item) => item.durationMs),
        final_pass_ms: finalPassMs,
      },
    },
  };
}

export async function runFinalPassOnly(args: {
  baselineMarkdown: string;
  style: FinalStyle;
  model: string;
  callLlm: LlmCall;
}): Promise<{ finalMarkdown: string; finalPassMs: number }> {
  const finalPrompt = buildFinalPrompt(args.style, args.baselineMarkdown);
  const start = Date.now();
  const finalMarkdown = await args.callLlm({
    systemPrompt: finalPrompt.systemPrompt,
    userPrompt: finalPrompt.userPrompt,
    model: args.model,
  });

  return {
    finalMarkdown,
    finalPassMs: Date.now() - start,
  };
}
