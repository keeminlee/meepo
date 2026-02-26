/**
 * classifyChunkOoc.ts: LLM-based per-event OOC classification for regime-flagged spans.
 *
 * The regime masks (pruneRegimes) flag entire chunks as OOC (oocHard/oocSoft), which is
 * too aggressive — chunks often contain mixed IC/OOC content. For example a chunk might
 * open with 2 lines of rules discussion then immediately return to in-character dialogue.
 *
 * This module refines those spans by running LLM extraction on each flagged chunk,
 * returning granular event ranges each with an individual is_ooc flag.
 *
 * Key constraints:
 *   - Does NOT write to database (pure in-memory refinement)
 *   - On any LLM failure, falls back to marking the whole span as OOC (safe default)
 *   - Relative indices in LLM response are remapped to absolute transcript indices on return
 */

import { chat } from "../llm/client.js";
import type { TranscriptEntry } from "../ledger/transcripts.js";
import { getDbForCampaign } from "../db.js";
import { getDefaultCampaignSlug } from "../campaign/defaultCampaign.js";
import { getEnv } from "../config/rawEnv.js";

export interface ChunkEventClassification {
  /** Absolute start index in full transcript array */
  start_index: number;
  /** Absolute end index in full transcript array (inclusive) */
  end_index: number;
  /** True = exclude from causal link analysis. False = keep eligible. */
  is_ooc: boolean;
}

/**
 * Classify lines within a single OOC-flagged span at event granularity.
 *
 * Sends the sub-transcript (relative indices 0..n-1) to the LLM and asks it to
 * partition it into contiguous events, each classified as IC or OOC. Relative
 * indices in the response are remapped to absolute transcript positions.
 *
 * @param span    The span as it appears in RegimeMasks (absolute array indices)
 * @param transcript  Full session transcript
 * @param model   OpenAI model to use (defaults to LLM_MODEL env or gpt-4o-mini)
 */
export async function classifyChunkOoc(
  span: { start_index: number; end_index: number },
  transcript: TranscriptEntry[],
  model: string = getEnv("LLM_MODEL", "gpt-4o-mini") ?? "gpt-4o-mini",
): Promise<ChunkEventClassification[]> {
  const lines = transcript.slice(span.start_index, span.end_index + 1);
  if (lines.length === 0) return [];

  // Build sub-transcript with relative indices [0..n-1]
  const subTranscript = lines
    .map((l, i) => `[${i}] ${l.author_name}: ${l.content}`)
    .join("\n");

  const totalMessages = lines.length;

  const systemPrompt = `You are analyzing a flagged segment of a D&D session transcript.

This segment was flagged as potentially out-of-character (OOC). Your task is to split it into fine-grained events and classify each as IC or OOC.

is_ooc = true (exclude from narrative analysis):
- Rules questions, spell lookups, dice mechanics discussion not involving the fiction
- Table logistics: "is everyone ready", bathroom breaks, "I need a minute"
- Tech/audio issues, real-world scheduling
- Explicit meta-talk: "wait, what does that ability do?", page references
- Any conversation clearly about the real world or game system, not the fictional story

is_ooc = false (keep for narrative analysis):
- Characters speaking or acting IN the fiction (even brief)
- DM narrating events, describing scene, responding to PC actions
- Players speaking AS their characters (in-character dialogue)
- In-world planning, negotiation, emotional beats, banter between characters
- DM recap of in-world events

Merge consecutive lines of the same classification into a single event.
Events must be contiguous and cover all ${totalMessages} lines with no gaps.

Return ONLY a JSON array (no markdown, no explanation):
[
  { "start_index": 0, "end_index": 4, "is_ooc": true },
  { "start_index": 5, "end_index": 11, "is_ooc": false }
]

Indices are relative to this segment: 0 = first line shown, ${totalMessages - 1} = last line shown.`;

  const userMessage = `Classify this transcript segment (${totalMessages} lines):\n\n${subTranscript}`;

  let rawResponse: string;
  try {
    rawResponse = await chat({
      systemPrompt,
      userMessage,
      model,
      temperature: 0.1,
      maxTokens: 2000,
    });
  } catch (err) {
    // LLM failure → conservative fallback: whole span stays OOC (matches old behaviour)
    console.error(
      `  [classifyChunkOoc] LLM failed for span [${span.start_index}-${span.end_index}], falling back to full-span OOC`,
    );
    return [{ start_index: span.start_index, end_index: span.end_index, is_ooc: true }];
  }

  // Strip markdown code fence if model wraps response
  const cleaned = rawResponse
    .replace(/^```(?:json)?\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();

  let relativeEvents: Array<{ start_index: number; end_index: number; is_ooc: boolean }>;
  try {
    relativeEvents = JSON.parse(cleaned);
  } catch {
    console.error(
      `  [classifyChunkOoc] Could not parse LLM response for span [${span.start_index}-${span.end_index}]:\n${rawResponse}`,
    );
    return [{ start_index: span.start_index, end_index: span.end_index, is_ooc: true }];
  }

  // Validate shape and remap to absolute indices
  return relativeEvents
    .filter(
      (e) =>
        typeof e.start_index === "number" &&
        typeof e.end_index === "number" &&
        typeof e.is_ooc === "boolean",
    )
    .map((e) => ({
      start_index: span.start_index + Math.max(0, e.start_index),
      end_index: span.start_index + Math.min(lines.length - 1, e.end_index),
      is_ooc: e.is_ooc,
    }));
}

/**
 * Cache-aware wrapper around classifyChunkOoc.
 *
 * On first call for a given (sessionId, span_start, span_end) the LLM is invoked
 * and the result stored in `ooc_span_classifications`. Subsequent calls return the
 * cached result immediately — no LLM cost.
 *
 * Pass `forceReclassify = true` to DELETE the cached row and re-run the LLM
 * (useful after transcript corrections or prompt changes).
 *
 * @param sessionId       Session UUID (cache key component)
 * @param span            OOC-flagged span (absolute indices)
 * @param transcript      Full transcript
 * @param model           OpenAI model
 * @param forceReclassify Delete cached row and re-run LLM
 */
export async function classifyChunkOocCached(
  sessionId: string,
  span: { start_index: number; end_index: number },
  transcript: TranscriptEntry[],
  model: string = getEnv("LLM_MODEL", "gpt-4o-mini") ?? "gpt-4o-mini",
  forceReclassify: boolean = false,
): Promise<ChunkEventClassification[]> {
  const db = getDbForCampaign(getDefaultCampaignSlug());

  if (forceReclassify) {
    db.prepare(
      `DELETE FROM ooc_span_classifications
       WHERE session_id = ? AND span_start = ? AND span_end = ?`,
    ).run(sessionId, span.start_index, span.end_index);
  }

  // Cache hit?
  const cached = db
    .prepare(
      `SELECT classifications FROM ooc_span_classifications
       WHERE session_id = ? AND span_start = ? AND span_end = ?`,
    )
    .get(sessionId, span.start_index, span.end_index) as
    | { classifications: string }
    | undefined;

  if (cached) {
    try {
      const result = JSON.parse(cached.classifications) as ChunkEventClassification[];
      console.error(
        `  [ooc cache] HIT  [${span.start_index}-${span.end_index}] -> ${result.length} event(s)`,
      );
      return result;
    } catch {
      // Corrupt cache row — fall through to re-classify
    }
  }

  // Cache miss — call LLM
  console.error(
    `  [ooc cache] MISS [${span.start_index}-${span.end_index}] calling LLM...`,
  );
  const result = await classifyChunkOoc(span, transcript, model);

  db.prepare(
    `INSERT OR REPLACE INTO ooc_span_classifications
       (session_id, span_start, span_end, classifications, classified_at_ms)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(sessionId, span.start_index, span.end_index, JSON.stringify(result), Date.now());

  return result;
}
