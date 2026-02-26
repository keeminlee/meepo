import type { TranscriptEntry } from "../../ledger/transcripts.js";
import { calculateCombatStats } from "../../causal/pruneRegimes.js";
import type { LineKind } from "./types.js";

const OOC_PATTERNS: RegExp[] = [
  /\b(out\s*of\s*character|ooc)\b/i,
  /\b(brb|afk|bio break|table talk|rules question|rules check)\b/i,
  /\b(mic|audio|discord|push to talk|ptt)\b/i,
  /^\s*\(/,
];

const NOISE_PATTERNS: RegExp[] = [
  /^\s*$/,
  /^\s*[\[\(]?\s*(laughter|laughs|crosstalk|unintelligible|inaudible)\s*[\]\)]?\s*$/i,
  /^\s*[.\-_,~]+\s*$/,
];

const COMBAT_ANCHORS: RegExp[] = [
  /\binitiative\b/i,
  /\broll\s+(for\s+)?initiative\b/i,
  /\battack\s+roll\b/i,
  /\bsaving\s+throw\b/i,
  /\bbonus\s+action\b/i,
  /\breaction\b/i,
  /\bcombat\s+begins\b/i,
  /\bcombat\s+ends\b/i,
];

export function classifyLineKind(line: TranscriptEntry): LineKind {
  const content = line.content ?? "";

  if (NOISE_PATTERNS.some((pattern) => pattern.test(content))) {
    return "noise";
  }

  if (OOC_PATTERNS.some((pattern) => pattern.test(content))) {
    return "ooc";
  }

  if (COMBAT_ANCHORS.some((pattern) => pattern.test(content))) {
    return "combat";
  }

  const combatStats = calculateCombatStats([
    {
      line_index: line.line_index,
      author_name: line.author_name,
      content: content,
      timestamp_ms: line.timestamp_ms,
    },
  ]);

  if (combatStats.combatScore >= 2 || combatStats.density >= 0.3) {
    return "combat";
  }

  return "narrative";
}
