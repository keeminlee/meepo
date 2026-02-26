import type { TranscriptEntry } from "../../ledger/transcripts.js";
import type { RegimeChunk } from "../../causal/pruneRegimes.js";
import {
  buildEligibilityMasksFromRegimeMasks,
  type EligibilityMasks,
  type EligibilityOptions,
} from "../../ledger/prune/eligibilityMasks.js";
import { generateRegimeMasks } from "../../causal/pruneRegimes.js";

export function getSilverEligibilityMasks(
  transcript: TranscriptEntry[],
  chunks: RegimeChunk[],
  options: EligibilityOptions,
): EligibilityMasks {
  const regimeMasks = generateRegimeMasks(chunks, transcript, {});
  return buildEligibilityMasksFromRegimeMasks(transcript, regimeMasks, options);
}
