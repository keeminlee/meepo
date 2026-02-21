/**
 * eligibilityMask.ts: Build line-level gating from chunk-based regime masks
 *
 * Converts chunk boundary logic (combat spans, OOC hard/soft) into a
 * line-indexed boolean array for fast O(1) lookup during link allocation.
 *
 * Two variants:
 *   buildEligibilityMask         — sync, treats entire OOC spans as ineligible (fast, aggressive)
 *   buildRefinedEligibilityMask  — async, runs LLM per OOC span to get event-level granularity;
 *                                  only marks individually confirmed OOC events as ineligible.
 *                                  Combat detection always stays heuristic (no LLM needed).
 */

import type { EligibilityMask, ExcludedRange } from "./types.js";
import type { RegimeMasks } from "./pruneRegimes.js";
import type { TranscriptEntry } from "../ledger/transcripts.js";
import { classifyChunkOocCached } from "./classifyChunkOoc.js";

/**
 * Build eligibility mask from regime masks and transcript length
 * 
 * @param transcript - Full transcript (needed for length)
 * @param masks - RegimeMasks from chunk pipeline (oocHard, oocSoft, combat)
 * @returns EligibilityMask with O(1) lookup and debug ranges
 */
export function buildEligibilityMask(
  transcript: Array<{ line_index: number }>,
  masks: RegimeMasks,
  sessionId: string,
): EligibilityMask {
  const transcriptLength = transcript.length;
  const eligible_mask = new Array(transcriptLength).fill(true);
  const excluded_ranges: ExcludedRange[] = [];

  // Mark hard OOC (conversation breaks, off-camera decisions, etc.)
  for (const span of masks.oocHard) {
    for (let i = span.start_index; i <= span.end_index; i++) {
      eligible_mask[i] = false;
    }
    excluded_ranges.push({
      start_index: span.start_index,
      end_index: span.end_index,
      reason: "ooc_hard",
    });
  }

  // Mark soft OOC (low alternation, long monologues) - can be toggled via flag
  for (const span of masks.oocSoft) {
    for (let i = span.start_index; i <= span.end_index; i++) {
      eligible_mask[i] = false;
    }
    excluded_ranges.push({
      start_index: span.start_index,
      end_index: span.end_index,
      reason: "ooc_soft",
    });
  }

  // Mark combat (roll-heavy, action trades)
  for (const span of masks.combat) {
    for (let i = span.start_index; i <= span.end_index; i++) {
      eligible_mask[i] = false;
    }
    excluded_ranges.push({
      start_index: span.start_index,
      end_index: span.end_index,
      reason: "combat",
    });
  }

  return {
    session_id: sessionId,
    eligible_mask,
    excluded_ranges,
    compiled_at_ms: Date.now(),
  };
}

/**
 * Async variant: builds eligibility mask with LLM-refined per-event OOC classification.
 *
 * For each span in oocHard and oocSoft:
 *   - Runs classifyChunkOoc() to partition the span into granular events
 *   - Only marks lines belonging to events confirmed as is_ooc=true as ineligible
 *   - Lines the LLM classifies as IC within an OOC-flagged chunk remain eligible
 *
 * Combat spans are still handled heuristically (anchor-based, no LLM needed).
 *
 * @param transcript  Full session transcript (needs TranscriptEntry content for LLM)
 * @param masks       RegimeMasks from generateRegimeMasks()
 * @param sessionId   Session UUID (stored on the mask and used as DB cache key)
 * @param model       OpenAI model for OOC classification (default: LLM_MODEL env or gpt-4o-mini)
 * @param forceReclassify  Delete cached classifications and re-run LLM for all spans
 */
export async function buildRefinedEligibilityMask(
  transcript: TranscriptEntry[],
  masks: RegimeMasks,
  sessionId: string,
  model?: string,
  forceReclassify: boolean = false,
): Promise<EligibilityMask> {
  const transcriptLength = transcript.length;
  const eligible_mask = new Array(transcriptLength).fill(true);
  const excluded_ranges: ExcludedRange[] = [];

  // Deduplicate: a chunk may appear in both oocHard and oocSoft; classify it only once
  const seen = new Set<string>();
  const allOocSpans = [...masks.oocHard, ...masks.oocSoft].filter((s) => {
    const key = `${s.start_index}:${s.end_index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  for (const span of allOocSpans) {
    const classifications = await classifyChunkOocCached(sessionId, span, transcript, model, forceReclassify);

    // Pessimistic default: mark entire span ineligible first.
    // Any line NOT covered by a classification remains excluded (safe fallback for LLM gaps).
    for (let i = span.start_index; i <= span.end_index; i++) {
      eligible_mask[i] = false;
    }

    // Unlock IC sub-events identified by LLM
    let oocRanges: Array<{ start_index: number; end_index: number }> = [];

    for (const cls of classifications) {
      if (!cls.is_ooc) {
        // LLM says IC — re-enable these lines
        for (let i = cls.start_index; i <= cls.end_index; i++) {
          eligible_mask[i] = true;
        }
      } else {
        oocRanges.push({ start_index: cls.start_index, end_index: cls.end_index });
      }
    }

    // If LLM gave no IC classifications at all, record the full span as-is
    if (oocRanges.length === 0) {
      oocRanges = [{ start_index: span.start_index, end_index: span.end_index }];
    }

    for (const r of oocRanges) {
      excluded_ranges.push({ ...r, reason: "ooc_refined" });
    }
  }

  // Combat: heuristic spans stay fully ineligible (anchor-based detection is reliable)
  for (const span of masks.combat) {
    for (let i = span.start_index; i <= span.end_index; i++) {
      eligible_mask[i] = false;
    }
    excluded_ranges.push({
      start_index: span.start_index,
      end_index: span.end_index,
      reason: "combat",
    });
  }

  return {
    session_id: sessionId,
    eligible_mask,
    excluded_ranges,
    compiled_at_ms: Date.now(),
  };
}

/**
 * Query eligibility of a single transcript line
 */
export function isLineEligible(mask: EligibilityMask, lineIndex: number): boolean {
  return mask.eligible_mask[lineIndex] ?? false;
}

/**
 * Get all excluded reasons for a line (can be multiple)
 */
export function getExclusionReasons(mask: EligibilityMask, lineIndex: number): Array<string> {
  const reasons: Array<string> = [];
  for (const range of mask.excluded_ranges) {
    if (lineIndex >= range.start_index && lineIndex <= range.end_index) {
      reasons.push(range.reason);
    }
  }
  return reasons;
}

/**
 * Find next eligible line starting from after startIndex
 */
export function findNextEligibleLine(
  mask: EligibilityMask,
  startIndex: number,
  maxLines: number = 10,
): number | null {
  for (let i = startIndex + 1; i < Math.min(startIndex + maxLines + 1, mask.eligible_mask.length); i++) {
    if (isLineEligible(mask, i)) {
      return i;
    }
  }
  return null;
}

/**
 * Count consecutive eligible lines starting from index
 */
export function countConsecutiveEligible(mask: EligibilityMask, startIndex: number): number {
  let count = 0;
  for (let i = startIndex; i < mask.eligible_mask.length; i++) {
    if (isLineEligible(mask, i)) {
      count++;
    } else {
      break;
    }
  }
  return count;
}
