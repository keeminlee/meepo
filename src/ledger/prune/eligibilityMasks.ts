import type { TranscriptEntry } from "../transcripts.js";
import type { RegimeMasks } from "../../causal/pruneRegimes.js";

export type EligibilityMasks = {
  length: number;
  is_ooc: boolean[];
  is_combat: boolean[];
};

export type EligibilityOptions = {
  combat_mode: "prune" | "include" | "include_not_counted";
};

export function buildEligibilityMasksFromRegimeMasks(
  transcript: TranscriptEntry[],
  regimeMasks: RegimeMasks,
  _options: EligibilityOptions,
): EligibilityMasks {
  const length = transcript.length;
  const is_ooc = new Array<boolean>(length).fill(false);
  const is_combat = new Array<boolean>(length).fill(false);

  markSpans(is_ooc, regimeMasks.oocHard);
  markSpans(is_ooc, regimeMasks.oocSoft);
  markSpans(is_combat, regimeMasks.combat);

  return {
    length,
    is_ooc,
    is_combat,
  };
}

function markSpans(mask: boolean[], spans: Array<{ start_index: number; end_index: number }>): void {
  for (const span of spans) {
    const start = Math.max(0, Math.min(span.start_index, span.end_index));
    const end = Math.min(mask.length - 1, Math.max(span.start_index, span.end_index));
    for (let i = start; i <= end; i++) {
      mask[i] = true;
    }
  }
}
