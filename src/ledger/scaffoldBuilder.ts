/**
 * scaffoldBuilder.ts
 *
 * Deterministic event scaffold generator.
 *
 * Algorithm overview:
 *
 *  1. CANDIDATE PASS
 *     Walk bronze lines. For each DM line, run signal detection.
 *     If signals fire AND the current span has reached minSpanLines,
 *     record a candidate boundary.
 *
 *  2. ADAPTIVE DM-RATIO TUNING
 *     Per-chunk dm_ratio is computed. Very DM-heavy long chunks get split
 *     at the next eligible candidate; very PC-heavy chunks tolerate longer spans.
 *
 *  3. MERGE PASS
 *     Remove micro-events (< minSpanLines/2) by merging them forward (or backward
 *     at the tail).
 *
 *  4. BUDGET ENFORCEMENT
 *     If total events exceed maxEvents, increase minSpanLines and re-run.
 *
 *  5. FORCE SPLIT
 *     Any surviving span > maxSpanLines is split at the midpoint with
 *     boundary_reason="fallback_split".
 */

import type { EventScaffold, ScaffoldOptions, BoundaryReason, BoundaryTrace } from "./scaffoldTypes.js";
import type { TranscriptEntry } from "./transcripts.js";
import { detectSignals, aggregateConfidence } from "./scaffoldSignals.js";
import { buildDmNameSet, detectDmSpeaker, isDmSpeaker } from "./scaffoldSpeaker.js";

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_MIN_SPAN = 25;
const DEFAULT_MAX_SPAN = 150;
const DEFAULT_MAX_EVENTS = 80;

// Category → BoundaryReason mapping
const CATEGORY_TO_REASON: Record<string, BoundaryReason> = {
  hard_cut:    "dm_hard_cut",
  time_skip:   "dm_time_skip",
  initiative:  "dm_initiative",
  scene_set:   "dm_scene_set",
  phase_change:"dm_phase_change",
  soft_confirm:"dm_soft_confirm",
  ooc:         "ooc_block",
};

function pickBoundaryReason(hits: ReturnType<typeof detectSignals>): BoundaryReason {
  // Priority: hard_cut > time_skip > initiative > phase_change > scene_set > soft_confirm > ooc
  const order: string[] = [
    "hard_cut","time_skip","initiative","phase_change","scene_set","soft_confirm","ooc"
  ];
  for (const cat of order) {
    if (hits.some((h) => h.category === cat)) {
      return CATEGORY_TO_REASON[cat] ?? "dm_scene_set";
    }
  }
  return "dm_scene_set";
}

// ── Internal candidate ────────────────────────────────────────────────────────

interface Candidate {
  lineIndex: number;
  reason: BoundaryReason;
  confidence: number;
  signalNames: string[];
}

// ── Core segmentation ─────────────────────────────────────────────────────────

function segment(
  lines: TranscriptEntry[],
  sessionId: string,
  minSpan: number,
  maxSpan: number,
  dmNames: Set<string>,
  includeSampleLines: boolean,
  trace?: BoundaryTrace[]
): EventScaffold[] {
  const n = lines.length;
  if (n === 0) return [];

  // ---- 1. Candidate pass ----
  const candidates: Candidate[] = [];
  let spanStart = 0;

  for (let i = 1; i < n; i++) {
    const line = lines[i];
    const spanLen = i - spanStart;

    if (!isDmSpeaker(line.author_name, dmNames)) continue;

    const hits = detectSignals(line.content);
    if (hits.length === 0) continue;

    const conf = aggregateConfidence(hits);
    const hardEnough = hits.some((h) =>
      h.category === "hard_cut" || h.category === "time_skip" ||
      h.category === "initiative" || h.category === "phase_change" ||
      (h.category === "scene_set" && h.confidence >= 0.75)
    );

    const signalNames = hits.map((h) => h.pattern);
    const accepted = spanLen >= minSpan || (hardEnough && spanLen >= Math.floor(minSpan * 0.5));

    // Record trace if provided
    if (trace) {
      const traceEntry: BoundaryTrace = {
        lineIndex: i,
        speaker: line.author_name,
        signalNames,
        confidence: conf,
        accepted,
      };
      if (!accepted) {
        if (spanLen < minSpan && !hardEnough) {
          traceEntry.reason = `span too short (${spanLen} < ${minSpan}) and weak signals`;
        } else if (spanLen < Math.floor(minSpan * 0.5) && hardEnough) {
          traceEntry.reason = `span too short (${spanLen} < ${Math.floor(minSpan * 0.5)}) for hard signal`;
        }
      }
      trace.push(traceEntry);
    }

    // Accept boundary if span is long enough OR signal is very strong
    if (accepted) {
      candidates.push({
        lineIndex: i,
        reason: pickBoundaryReason(hits),
        confidence: conf,
        signalNames,
      });
      spanStart = i;
    }
  }

  // ---- 2. Materialise spans from candidates ----
  const breakpoints = [0, ...candidates.map((c) => c.lineIndex)];
  const breaks: Map<number, Candidate | null> = new Map();
  breaks.set(0, null);
  for (const c of candidates) breaks.set(c.lineIndex, c);

  function makeSpan(start: number, end: number, cand: Candidate | null): EventScaffold {
    const spanLines = lines.slice(start, end + 1);
    const dmCount = spanLines.filter((l) => isDmSpeaker(l.author_name, dmNames)).length;
    const dmRatio = spanLines.length > 0 ? dmCount / spanLines.length : 0;

    const reason: BoundaryReason = cand?.reason ?? "session_start";
    const confidence = cand?.confidence ?? 1.0;
    const signalHits = cand?.signalNames ?? [];

    let sampleLines: string[] | undefined;
    if (includeSampleLines) {
      sampleLines = lines
        .slice(start, Math.min(start + 3, end + 1))
        .map((l) => `[L${l.line_index}] ${l.author_name}: ${l.content.slice(0, 120)}`);
    }

    return {
      event_id: "",           // filled in final numbering pass
      session_id: sessionId,
      start_index: start,
      end_index: end,
      boundary_reason: reason,
      confidence,
      dm_ratio: dmRatio,
      signal_hits: signalHits,
      ...(sampleLines ? { sample_lines: sampleLines } : {}),
    };
  }

  let spans: EventScaffold[] = [];
  for (let i = 0; i < breakpoints.length; i++) {
    const start = breakpoints[i];
    const end = i + 1 < breakpoints.length ? breakpoints[i + 1] - 1 : n - 1;
    const cand = breaks.get(start) ?? null;
    spans.push(makeSpan(start, end, cand));
  }

  // ---- 3. Adaptive DM-ratio: split DM-heavy long spans ----
  const result: EventScaffold[] = [];
  for (const span of spans) {
    const len = span.end_index - span.start_index + 1;
    const tooLong = len > maxSpan;
    const dmHeavy = span.dm_ratio > 0.60 && len > minSpan * 2;

    if (!tooLong && !dmHeavy) {
      result.push(span);
      continue;
    }

    // Force-split at midpoint
    const mid = span.start_index + Math.floor(len / 2);
    result.push(makeSpan(span.start_index, mid - 1, breaks.get(span.start_index) ?? null));
    result.push(makeSpan(mid, span.end_index, {
      lineIndex: mid,
      reason: "fallback_split",
      confidence: 0.3,
      signalNames: [],
    }));
  }

  return result;
}

// ── Merge pass ────────────────────────────────────────────────────────────────

function mergeMicro(spans: EventScaffold[], minSpan: number): EventScaffold[] {
  const micro = Math.floor(minSpan / 2);
  let changed = true;

  while (changed) {
    changed = false;
    const out: EventScaffold[] = [];

    for (let i = 0; i < spans.length; i++) {
      const span = spans[i];
      const len = span.end_index - span.start_index + 1;

      if (len < micro && i + 1 < spans.length) {
        // Merge forward
        const next = spans[i + 1];
        out.push({
          ...span,
          end_index: next.end_index,
          signal_hits: [...span.signal_hits, ...next.signal_hits],
          sample_lines: span.sample_lines,
        });
        i++; // skip next
        changed = true;
      } else if (len < micro && out.length > 0) {
        // Merge backward into previous
        const prev = out[out.length - 1];
        out[out.length - 1] = {
          ...prev,
          end_index: span.end_index,
          signal_hits: [...prev.signal_hits, ...span.signal_hits],
        };
        changed = true;
      } else {
        out.push(span);
      }
    }

    spans = out;
  }

  return spans;
}

// ── Force-split oversized spans ───────────────────────────────────────────────

function forceSplit(
  spans: EventScaffold[],
  maxSpan: number,
  lines: TranscriptEntry[],
  sessionId: string,
  dmNames: Set<string>,
  includeSampleLines: boolean
): EventScaffold[] {
  const out: EventScaffold[] = [];

  for (const span of spans) {
    const len = span.end_index - span.start_index + 1;
    if (len <= maxSpan) {
      out.push(span);
      continue;
    }

    // Recursively split
    const mid = span.start_index + Math.floor(len / 2);
    const a: EventScaffold = {
      ...span,
      end_index: mid - 1,
    };
    const b: EventScaffold = {
      event_id: "",
      session_id: sessionId,
      start_index: mid,
      end_index: span.end_index,
      boundary_reason: "fallback_split",
      confidence: 0.2,
      dm_ratio: span.dm_ratio,
      signal_hits: [],
      ...(includeSampleLines
        ? {
            sample_lines: lines
              .slice(mid, Math.min(mid + 3, span.end_index + 1))
              .map((l) => `[L${l.line_index}] ${l.author_name}: ${l.content.slice(0, 120)}`),
          }
        : {}),
    };
    out.push(...forceSplit([a, b], maxSpan, lines, sessionId, dmNames, includeSampleLines));
  }

  return out;
}

// ── Number events ─────────────────────────────────────────────────────────────

function numberEvents(spans: EventScaffold[]): EventScaffold[] {
  return spans.map((s, i) => ({
    ...s,
    event_id: `E${String(i + 1).padStart(4, "0")}`,
  }));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build a deterministic event scaffold from bronze transcript lines.
 *
 * @param lines       - From getBronzeTranscript() or buildTranscript()
 * @param sessionId   - Session UUID
 * @param opts        - Tuning options
 * @param traceOut    - Optional array to populate with boundary trace (for --trace mode)
 */
export function buildEventScaffold(
  lines: TranscriptEntry[],
  sessionId: string,
  opts: ScaffoldOptions = {},
  traceOut?: BoundaryTrace[]
): EventScaffold[] {
  let minSpan = opts.minSpanLines ?? DEFAULT_MIN_SPAN;
  const maxSpan = opts.maxSpanLines ?? DEFAULT_MAX_SPAN;
  const maxEvents = opts.maxEvents ?? DEFAULT_MAX_EVENTS;
  const includeSampleLines = opts.includeSampleLines ?? true;
  const includeTrace = !!traceOut;

  // Detect DM speaker from transcript speaker names
  const uniqueSpeakers = Array.from(new Set(lines.map((l) => l.author_name)));
  const detectedDm = detectDmSpeaker(uniqueSpeakers);
  const dmNames = buildDmNameSet(detectedDm, opts.dmNames);

  let spans: EventScaffold[] = [];
  let attempts = 0;

  // Budget enforcement loop: inflate minSpan until events fit budget
  while (true) {
    // Clear trace before each pass, only collect on final accepted pass
    if (traceOut) traceOut.length = 0;
    
    spans = segment(lines, sessionId, minSpan, maxSpan, dmNames, includeSampleLines, traceOut);
    spans = mergeMicro(spans, minSpan);
    spans = forceSplit(spans, maxSpan, lines, sessionId, dmNames, includeSampleLines);

    if (spans.length <= maxEvents || attempts >= 5) break;

    // Budget exceeded — inflate minSpan by 25% and retry
    minSpan = Math.ceil(minSpan * 1.25);
    attempts++;
  }

  return numberEvents(spans);
}
