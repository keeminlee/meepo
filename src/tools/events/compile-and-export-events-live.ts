import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { chat } from "../../llm/client.js";
import { parseJsonArrayFromLlm } from "../../llm/parseJsonFromLlm.js";
import { getEnv } from "../../config/rawEnv.js";
import { getDbForCampaign } from "../../db.js";
import { getDefaultCampaignSlug } from "../../campaign/defaultCampaign.js";
import { buildTranscript } from "../../ledger/transcripts.js";
import { buildEligibleExcerpt } from "../../ledger/excerpts/buildEligibleExcerpt.js";
import { resolveCampaignExportSubdir } from "../../dataPaths.js";
import { segmentTranscript } from "../../silver/seq/segmentTranscript.js";
import { classifyLineKind } from "../../silver/seq/classifyLineKind.js";
import { compileEventsFromTranscript } from "../../events/compileEvents/compileEventsFromTranscript.js";
import { validateEventSpans } from "../../events/compileEvents/validateEventSpans.js";
import { shapeEventsArtifact } from "../../events/compileEvents/shapeEventsArtifact.js";
import type { CompileEventsLlm, CompiledEvent, TranscriptEventLine } from "../../events/compileEvents/types.js";

const defaultLlmModel = getEnv("LLM_MODEL", "gpt-4o-mini") ?? "gpt-4o-mini";

function parseArgs(): {
  sessionLabel: string;
  campaign: string;
  targetLines: number;
  minLines: number;
  maxLines: number;
  snapWindow: number;
  combatMode: "prune" | "include" | "include_not_counted";
  pruneRegime: string;
  maxLlmLines: number;
} {
  const args = process.argv.slice(2);
  let sessionLabel = "";
  let campaign = getDefaultCampaignSlug();
  let targetLines = 250;
  let minLines = 200;
  let maxLines = 300;
  let snapWindow = 25;
  let combatMode: "prune" | "include" | "include_not_counted" = "prune";
  let pruneRegime = "v1_default";
  let maxLlmLines = 60;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--session" && args[i + 1]) {
      sessionLabel = args[++i];
    } else if (args[i] === "--campaign" && args[i + 1]) {
      campaign = args[++i];
    } else if (args[i] === "--target_lines" && args[i + 1]) {
      targetLines = Number(args[++i]);
    } else if (args[i] === "--min_lines" && args[i + 1]) {
      minLines = Number(args[++i]);
    } else if (args[i] === "--max_lines" && args[i + 1]) {
      maxLines = Number(args[++i]);
    } else if (args[i] === "--snap_window" && args[i + 1]) {
      snapWindow = Number(args[++i]);
    } else if (args[i] === "--combat_mode" && args[i + 1]) {
      const mode = args[++i];
      if (mode === "prune" || mode === "include" || mode === "include_not_counted") {
        combatMode = mode;
      }
    } else if (args[i] === "--prune_regime" && args[i + 1]) {
      pruneRegime = args[++i];
    } else if (args[i] === "--max_llm_lines" && args[i + 1]) {
      maxLlmLines = Number(args[++i]);
    }
  }

  if (!sessionLabel) {
    throw new Error("Missing required argument: --session <SESSION_LABEL>");
  }

  return { sessionLabel, campaign, targetLines, minLines, maxLines, snapWindow, combatMode, pruneRegime, maxLlmLines };
}

function getSession(sessionLabel: string, campaign: string): { session_id: string; label: string } {
  const db = getDbForCampaign(campaign);
  const session = db
    .prepare(
      `SELECT session_id, label
       FROM sessions
       WHERE label = ?
       ORDER BY created_at_ms DESC
       LIMIT 1`,
    )
    .get(sessionLabel) as { session_id: string; label: string } | undefined;

  if (!session) {
    throw new Error(`Session not found: ${sessionLabel}`);
  }

  return session;
}

function buildLlmAdapter(model: string): CompileEventsLlm {
  let callCount = 0;

  return {
    async extractEvents(params): Promise<CompiledEvent[]> {
      callCount += 1;
      const batchId = `call_${String(callCount).padStart(3, "0")}`;

      const systemPrompt = `You are an assistant that extracts narrative events from D&D session transcripts.

Your task is to segment the transcript into distinct, contiguous narrative events.

Classify each event with exactly one event_type:
- action
- dialogue
- discovery
- emotional
- conflict
- plan
- transition
- recap
- ooc_logistics

Also include is_ooc boolean.

Rules:
- Use transcript indices exactly as shown in [N]
- Keep events contiguous with no overlaps
- Prefer fewer, coherent beats over micro-splits
- Return valid JSON object with key "events" containing the array, and no markdown fences`;

      const userMessage = `Extract events from transcript lines [${params.rangeStartIndex}-${params.rangeEndIndex}] of session transcript (${params.totalMessages} total lines):\n\n${params.transcript}`;

      const reqChars = systemPrompt.length + userMessage.length;
      const callStart = Date.now();
      console.log(
        `[llm] batch=${batchId} range=[${params.rangeStartIndex}-${params.rangeEndIndex}] reqChars=${reqChars} start=${new Date(callStart).toISOString()}`,
      );

      const response = await chat({
        systemPrompt,
        userMessage,
        model,
        temperature: 0.2,
        maxTokens: 16000,
        responseFormat: "json_object",
      });

      const elapsed = Date.now() - callStart;
      console.log(`[llm] batch=${batchId} ms=${elapsed} respChars=${response.length}`);

      const parsed = parseJsonArrayFromLlm(response, ["events", "items", "data"]) as CompiledEvent[];
      return parsed;
    },
  };
}

function buildEligibleIncludeMask(
  transcript: ReturnType<typeof buildTranscript>,
  combatMode: "prune" | "include" | "include_not_counted",
): boolean[] {
  return transcript.map((line) => {
    const kind = classifyLineKind(line);
    if (kind === "narrative") return true;
    if (kind === "combat") {
      return combatMode === "include" || combatMode === "include_not_counted";
    }
    return false;
  });
}

function buildVisualization(
  sessionLabel: string,
  events: CompiledEvent[],
  entries: TranscriptEventLine[],
): string {
  let output = "";
  output += `${"═".repeat(80)}\n`;
  output += `SESSION: ${sessionLabel}\n`;
  output += `${"═".repeat(80)}\n\n`;

  for (const event of events) {
    const participants = new Set<string>();
    for (let i = event.start_index; i <= event.end_index; i++) {
      const line = entries.find((item) => item.index === i);
      if (line) participants.add(line.author);
    }

    output += `\n${"─".repeat(80)}\n`;
    output += `${event.title}\n`;
    output += `Type: ${event.event_type} | Participants: ${Array.from(participants).join(", ") || "Unknown"}\n`;
    output += `Span: [${event.start_index}-${event.end_index}] | Mode: ${event.is_ooc ? "OOC" : "IC"}\n`;
    output += `${"─".repeat(80)}\n\n`;

    for (let i = event.start_index; i <= event.end_index; i++) {
      const line = entries.find((item) => item.index === i);
      if (line) {
        output += `${line.author}: ${line.content}\n`;
      }
    }
  }

  output += `\n${"═".repeat(80)}\nEND OF SESSION\n${"═".repeat(80)}\n`;
  return output;
}

function upsertEventsInCampaignDb(
  db: any,
  sessionId: string,
  events: CompiledEvent[],
  lines: TranscriptEventLine[],
): { inserted: number; updated: number } {
  const lineMap = new Map<number, TranscriptEventLine>();
  for (const line of lines) {
    lineMap.set(line.index, line);
  }

  const tx = db.transaction(() => {
    let inserted = 0;
    let updated = 0;

    for (const event of events) {
      const existing = db
        .prepare(
          `SELECT id FROM events
           WHERE session_id = ? AND start_index = ? AND end_index = ? AND event_type = ?`,
        )
        .get(sessionId, event.start_index, event.end_index, event.event_type) as { id: string } | undefined;

      const eventId = existing?.id ?? randomUUID();
      const startLine = lineMap.get(event.start_index);

      const participants = new Set<string>();
      for (let i = event.start_index; i <= event.end_index; i++) {
        const line = lineMap.get(i);
        if (line) participants.add(line.author);
      }

      db.prepare(
        `INSERT OR REPLACE INTO events (
          id, session_id, event_type, participants, description,
          confidence, start_index, end_index, timestamp_ms, created_at_ms, is_ooc
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        eventId,
        sessionId,
        event.event_type,
        JSON.stringify(Array.from(participants).sort((a, b) => a.localeCompare(b))),
        event.title,
        0.85,
        event.start_index,
        event.end_index,
        startLine?.timestamp ?? Date.now(),
        Date.now(),
        event.is_ooc ? 1 : 0,
      );

      if (existing) updated += 1;
      else inserted += 1;
    }

    return { inserted, updated };
  });

  return tx();
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const args = parseArgs();
  const db = getDbForCampaign(args.campaign);
  const session = getSession(args.sessionLabel, args.campaign);

  const transcript = buildTranscript(session.session_id, { view: "bronze", primaryOnly: true }, db);
  const transcriptLines: TranscriptEventLine[] = transcript.map((line) => ({
    index: line.line_index,
    author: line.author_name,
    content: line.content,
    timestamp: line.timestamp_ms,
  }));

  const segmentation = segmentTranscript({
    lines: transcript,
    targetNarrativeLines: args.targetLines,
    minNarrativeLines: args.minLines,
    maxNarrativeLines: args.maxLines,
    snapWindow: args.snapWindow,
    combatMode: args.combatMode,
    pruneRegime: args.pruneRegime,
  });

  console.log(`📊 Live compile diagnostics`);
  console.log(`  bronze lines: ${transcriptLines.length}`);
  console.log(`  segments: ${segmentation.segments.length}`);
  console.log(`  llm items: ${segmentation.segments.length}`);
  console.log(`  llm batches: ${segmentation.segments.length}`);
  console.log(`  max_llm_lines: ${Math.max(1, Math.floor(args.maxLlmLines))}`);

  const eligibleInclude = buildEligibleIncludeMask(transcript, args.combatMode);

  const compileSegments = segmentation.segments.map((segment) => {
    const eligibleInSegment = eligibleInclude
      .slice(segment.startLineIndex, segment.endLineIndex + 1)
      .filter(Boolean).length;

    const excerpt = buildEligibleExcerpt(
      transcript,
      segment.startLineIndex,
      segment.endLineIndex,
      eligibleInclude,
      Math.max(1, Math.floor(args.maxLlmLines)),
    );

    const firstExcerptIdx = excerpt.excerptLineIndices.length > 0 ? excerpt.excerptLineIndices[0] : null;
    const lastExcerptIdx =
      excerpt.excerptLineIndices.length > 0
        ? excerpt.excerptLineIndices[excerpt.excerptLineIndices.length - 1]
        : null;

    console.log(
      `  segment ${segment.id}: lines=${segment.totalLineCount} narrative=${segment.narrativeLineCount} range=[${segment.startLineIndex}-${segment.endLineIndex}] eligible_in_segment=${eligibleInSegment} excerpt_lines_used=${excerpt.excerptLineIndices.length} excerpt_range=[${firstExcerptIdx ?? "n/a"}-${lastExcerptIdx ?? "n/a"}]`,
    );

    return {
      id: segment.id,
      startLineIndex: segment.startLineIndex,
      endLineIndex: segment.endLineIndex,
      excerptText: excerpt.excerptText,
      excerptLineIndices: excerpt.excerptLineIndices,
    };
  });

  const llm = buildLlmAdapter(defaultLlmModel);
  const compiled = await compileEventsFromTranscript({
    lines: transcriptLines,
    segments: compileSegments,
    llm,
  });

  const validation = validateEventSpans(compiled.events, transcriptLines.length);
  if (!validation.isValid) {
    console.error("❌ Event validation failed:");
    for (const issue of validation.issues) {
      console.error(`  ${issue}`);
    }
    process.exit(1);
  }

  const upsert = upsertEventsInCampaignDb(db, session.session_id, compiled.events, transcriptLines);

  const eventsDir = resolveCampaignExportSubdir(args.campaign, "events", {
    forWrite: true,
    ensureExists: true,
  });

  const artifact = shapeEventsArtifact({
    sessionId: session.session_id,
    sessionLabel: session.label,
    events: compiled.events,
    lines: transcriptLines,
  });

  fs.writeFileSync(
    path.join(eventsDir, `events_${session.label}.json`),
    JSON.stringify(artifact, null, 2),
    "utf-8",
  );

  const visualization = buildVisualization(session.label, compiled.events, transcriptLines);
  fs.writeFileSync(path.join(eventsDir, `events_${session.label}.txt`), visualization, "utf-8");

  console.log(`✅ Live events compiled for ${session.label}`);
  console.log(`  Segments: ${segmentation.segments.length}`);
  console.log(`  Events: ${compiled.events.length}`);
  console.log(`  DB upsert: inserted=${upsert.inserted}, updated=${upsert.updated}`);
  console.log(`  Metrics coverage: ${segmentation.metrics.coverageNarrative}`);
  console.log(`  Total runtime ms: ${Date.now() - t0}`);
  console.log(`  Output dir: ${eventsDir}`);
}

main().catch((err) => {
  console.error("❌", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
