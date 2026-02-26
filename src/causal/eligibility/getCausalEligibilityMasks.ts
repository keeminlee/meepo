import type { TranscriptEntry } from "../../ledger/transcripts.js";
import type { RegimeChunk } from "../pruneRegimes.js";
import { generateRegimeMasks } from "../pruneRegimes.js";
import {
  buildEligibilityMasksFromRegimeMasks,
  type EligibilityMasks,
  type EligibilityOptions,
} from "../../ledger/prune/eligibilityMasks.js";

export function getCausalEligibilityMasks(
  transcript: TranscriptEntry[],
  chunks: RegimeChunk[],
  options: EligibilityOptions,
): EligibilityMasks {
  const regimeMasks = generateRegimeMasks(chunks, transcript, {});
  return buildEligibilityMasksFromRegimeMasks(transcript, regimeMasks, options);
}
