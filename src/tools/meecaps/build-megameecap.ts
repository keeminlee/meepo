import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { getDbForCampaign } from "../../db.js";
import { getDefaultCampaignSlug } from "../../campaign/defaultCampaign.js";
import { getEnv } from "../../config/rawEnv.js";
import { buildTranscript } from "../../ledger/transcripts.js";
import { resolveCampaignExportSubdir } from "../../dataPaths.js";
import { generateNarrativeMeecapFromTranscript } from "../../sessions/meecap.js";
import { segmentTranscript } from "../../silver/seq/segmentTranscript.js";
import {
  buildSegmentPayload,
  stableHash,
  type SegmentPayload,
} from "./megameecapCore.js";

type SegmentCallMeta = {
  seg_id: string;
  start_index: number;
  end_index: number;
  lines_total: number;
  lines_sent: number;
  sent_line_start: number;
  sent_line_end: number;
  context_chars_used: number;
  req_chars_estimate: number;
  resp_chars: number;
  ms: number;
  narrative_hash: string;
};

type Args = {
  sessionLabel: string;
  campaign: string;
  maxLlmLines: number;
  contextSegments: number;
  contextChars: number;
  model: string;
  dryRun: boolean;
  targetLines: number;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);

  let sessionLabel = "";
  let campaign = getDefaultCampaignSlug();
  let maxLlmLines = 200;
  let contextSegments = 3;
  let contextChars = 12000;
  let targetLines = 250;
  let model = getEnv("LLM_MODEL", "gpt-4o-mini") ?? "gpt-4o-mini";
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--session" && argv[i + 1]) {
      sessionLabel = argv[++i];
    } else if (arg === "--campaign" && argv[i + 1]) {
      campaign = argv[++i];
    } else if (arg === "--max_llm_lines" && argv[i + 1]) {
      maxLlmLines = Number(argv[++i]);
    } else if (arg === "--context_segments" && argv[i + 1]) {
      contextSegments = Number(argv[++i]);
    } else if (arg === "--context_chars" && argv[i + 1]) {
      contextChars = Number(argv[++i]);
    } else if (arg === "--model" && argv[i + 1]) {
      model = argv[++i];
    } else if (arg === "--target_lines" && argv[i + 1]) {
      targetLines = Number(argv[++i]);
    } else if (arg === "--dry_run") {
      dryRun = true;
    }
  }

  if (!sessionLabel) {
    throw new Error("Missing required argument: --session <SESSION_LABEL>");
  }

  return {
    sessionLabel,
    campaign,
    maxLlmLines: Math.max(1, Math.floor(maxLlmLines)),
    contextSegments: Math.max(0, Math.floor(contextSegments)),
    contextChars: Math.max(0, Math.floor(contextChars)),
    model,
    dryRun,
    targetLines: Math.max(1, Math.floor(targetLines)),
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

function buildMarkdown(args: {
  sessionLabel: string;
  campaign: string;
  generatedAtIso: string;
  segmentCount: number;
  targetLines: number;
  maxLlmLines: number;
  contextSegments: number;
  contextChars: number;
  model: string;
  segments: Array<{
    seg_id: string;
    start_index: number;
    end_index: number;
    lines_total: number;
    lines_sent: number;
    narrative: string;
  }>;
}): string {
  const header = [
    `# MegaMeecap — ${args.sessionLabel}`,
    "",
    `- Campaign: ${args.campaign}`,
    `- Generated: ${args.generatedAtIso}`,
    "- Transcript view: bronze",
    `- Segments: ${args.segmentCount}`,
    `- Segment target lines: ${args.targetLines}`,
    `- max_llm_lines: ${args.maxLlmLines}`,
    `- context_segments: ${args.contextSegments}`,
    `- context_chars: ${args.contextChars}`,
    `- Model: ${args.model}`,
    "",
    "---",
  ].join("\n");

  const body = args.segments
    .map((segment) => {
      return [
        "",
        `## Segment ${segment.seg_id} (range [${segment.start_index}–${segment.end_index}], lines=${segment.lines_total}, sent=${segment.lines_sent})`,
        segment.narrative,
        "",
        "---",
      ].join("\n");
    })
    .join("\n");

  return `${header}${body}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const db = getDbForCampaign(args.campaign);
  const session = resolveSession(db, args.sessionLabel);

  const transcript = buildTranscript(session.session_id, { view: "bronze", primaryOnly: true }, db);
  if (transcript.length === 0) {
    throw new Error(`No bronze transcript lines found for session ${session.label}`);
  }

  const transcriptHash = stableHash(
    transcript.map((line) => ({
      line_index: line.line_index,
      author_name: line.author_name,
      content: line.content,
      timestamp_ms: line.timestamp_ms,
      source_type: line.source_type ?? null,
      source_ids: line.source_ids ?? [],
    })),
  );

  const segmentation = segmentTranscript({
    lines: transcript,
    targetNarrativeLines: args.targetLines,
    minNarrativeLines: args.targetLines,
    maxNarrativeLines: args.targetLines,
    snapWindow: 0,
    combatMode: "include",
    pruneRegime: "v1_default",
    countAllLines: true,
  });

  const segments = segmentation.segments.map((segment) => ({
    seg_id: segment.id,
    start_index: segment.startLineIndex,
    end_index: segment.endLineIndex,
    line_count: segment.totalLineCount,
  }));
  const previousMeecaps: string[] = [];
  const perCall: SegmentCallMeta[] = [];
  const markdownSegments: Array<{
    seg_id: string;
    start_index: number;
    end_index: number;
    lines_total: number;
    lines_sent: number;
    narrative: string;
  }> = [];

  for (const segment of segments) {
    const payload = buildSegmentPayload({
      segment,
      transcriptLines: transcript,
      previousMeecaps,
      maxLlmLines: args.maxLlmLines,
      contextSegments: args.contextSegments,
      contextChars: args.contextChars,
    });

    console.log(
      `[megameecap] ${payload.seg_id} range=[${payload.start_index}-${payload.end_index}] lines_total=${payload.lines_total} lines_sent=${payload.lines_sent} context_chars_used=${payload.context_chars_used} reqChars~${payload.req_chars_estimate}`,
    );

    if (args.dryRun) {
      perCall.push({
        seg_id: payload.seg_id,
        start_index: payload.start_index,
        end_index: payload.end_index,
        lines_total: payload.lines_total,
        lines_sent: payload.lines_sent,
        sent_line_start: payload.sent_line_start,
        sent_line_end: payload.sent_line_end,
        context_chars_used: payload.context_chars_used,
        req_chars_estimate: payload.req_chars_estimate,
        resp_chars: 0,
        ms: 0,
        narrative_hash: stableHash({ dry_run: true, seg_id: payload.seg_id }),
      });
      continue;
    }

    const callStart = Date.now();
    const generated = await generateNarrativeMeecapFromTranscript({
      sessionId: session.session_id,
      transcript: payload.wrapped_transcript,
      entryCount: payload.lines_sent,
      model: args.model,
    });
    const elapsed = Date.now() - callStart;

    if (generated.validationErrors.length > 0) {
      throw new Error(
        `Narrative validation failed for ${payload.seg_id}: ${generated.validationErrors.join(" | ")}`,
      );
    }

    console.log(
      `[megameecap] ${payload.seg_id} ms=${elapsed} respChars=${generated.narrative.length}`,
    );

    previousMeecaps.push(generated.narrative);
    markdownSegments.push({
      seg_id: payload.seg_id,
      start_index: payload.start_index,
      end_index: payload.end_index,
      lines_total: payload.lines_total,
      lines_sent: payload.lines_sent,
      narrative: generated.narrative,
    });
    perCall.push({
      seg_id: payload.seg_id,
      start_index: payload.start_index,
      end_index: payload.end_index,
      lines_total: payload.lines_total,
      lines_sent: payload.lines_sent,
      sent_line_start: payload.sent_line_start,
      sent_line_end: payload.sent_line_end,
      context_chars_used: payload.context_chars_used,
      req_chars_estimate: payload.req_chars_estimate,
      resp_chars: generated.narrative.length,
      ms: elapsed,
      narrative_hash: stableHash(generated.narrative),
    });
  }

  const meta = {
    session: session.label,
    session_id: session.session_id,
    campaign: args.campaign,
    transcript_hash: transcriptHash,
    generated_at: new Date().toISOString(),
    dry_run: args.dryRun,
    params: {
      target_lines: args.targetLines,
      max_llm_lines: args.maxLlmLines,
      context_segments: args.contextSegments,
      context_chars: args.contextChars,
      model: args.model,
      transcript_view: "bronze",
    },
    segments: segments.map((segment) => ({
      seg_id: segment.seg_id,
      start_index: segment.start_index,
      end_index: segment.end_index,
      line_count: segment.line_count,
    })),
    calls: perCall,
    dry_run_hash: stableHash({
      transcript_hash: transcriptHash,
      params: {
        target_lines: args.targetLines,
        max_llm_lines: args.maxLlmLines,
        context_segments: args.contextSegments,
        context_chars: args.contextChars,
        model: args.model,
      },
      segments,
      calls: perCall.map((call) => ({
        seg_id: call.seg_id,
        lines_total: call.lines_total,
        lines_sent: call.lines_sent,
        context_chars_used: call.context_chars_used,
        req_chars_estimate: call.req_chars_estimate,
        sent_line_start: call.sent_line_start,
        sent_line_end: call.sent_line_end,
      })),
    }),
  };

  if (args.dryRun) {
    console.log("\n[dry_run] MegaMeecap plan");
    console.log(JSON.stringify(meta, null, 2));
    return;
  }

  const meecapsDir = resolveCampaignExportSubdir(args.campaign, "meecaps", {
    forWrite: true,
    ensureExists: true,
  });
  const markdownPath = path.join(meecapsDir, `megameecap_${session.label}.md`);
  const metaPath = path.join(meecapsDir, `megameecap_${session.label}.meta.json`);

  const markdown = buildMarkdown({
    sessionLabel: session.label,
    campaign: args.campaign,
    generatedAtIso: meta.generated_at,
    segmentCount: segments.length,
    targetLines: args.targetLines,
    maxLlmLines: args.maxLlmLines,
    contextSegments: args.contextSegments,
    contextChars: args.contextChars,
    model: args.model,
    segments: markdownSegments,
  });

  fs.writeFileSync(markdownPath, markdown, "utf-8");
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");

  console.log(`\n✅ MegaMeecap generated: ${markdownPath}`);
  console.log(`✅ Meta written: ${metaPath}`);
}

main().catch((err) => {
  console.error("❌", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
