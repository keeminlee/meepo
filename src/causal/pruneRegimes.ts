import type { TranscriptEntry } from "../ledger/transcripts.js";
import { buildDmNameSet, detectDmSpeaker, isDmSpeaker } from "../ledger/scaffoldSpeaker.js";

export type Span = {
  start_index: number;
  end_index: number;
  reason: string;
  chunk_id?: string;
  chunk_index?: number;
};

export type RegimeMasks = {
  oocHard: Span[];
  oocSoft: Span[];
  combat: Span[];
};

export type RegimeChunk = {
  chunk_id: string;
  chunk_index: number;
  start_index: number;
  end_index: number;
  is_ooc?: boolean;
};

export type RegimeMaskOptions = {
  alternationThreshold?: number;
  combatDensityThreshold?: number;
  combatDensityLow?: number;
  debugCombat?: boolean;
};

const DEFAULT_ALTERNATION_THRESHOLD = 0.55;
const DEFAULT_COMBAT_DENSITY_THRESHOLD = 0.006;
const DEFAULT_COMBAT_DENSITY_LOW = 0.002;

// Combat detection v0 (anchor-first + weighted scoring)
const MIN_TOKENS_SEED = 3;
const T_SEED = 0.3; // Raised for weighted scoring (old: 0.02)

// Start-of-combat anchor patterns
const COMBAT_START_PATTERNS = [
  /\binitiative\b/i,
  /\broll\s+(for\s+)?initiative\b/i,
  /\benter\s+combat\b/i,
  /\bcombat\s+begins\b/i,
  /\bstart\s+combat\b/i,
  /\binitiative\s+order\b/i,
];

// End-of-combat anchor patterns
const COMBAT_END_PATTERNS = [
  /\bend\s+of\s+combat\b/i,
  /\bout\s+of\s+combat\b/i,
  /\bbrings\s+us\s+(to\s+)?the\s+end\s+of\s+combat\b/i,
  /\bwe'?re\s+out\s+of\s+(initiative|turn\s+order)\b/i,
  /\bout\s+of\s+(initiative|turn\s+order)\b/i,
  /\bleave\s+(initiative|turn\s+order)\b/i,
  /\bexit\s+(initiative|turn\s+order)\b/i,
  /\bcombat\s+ends\b/i,
  /\bend\s+of\s+(initiative|turn\s+order)\b/i,
];

// Weighted combat token sets
const HARD_COMBAT_TOKENS = new Set([
  "initiative",
  "turnorder",
  "round",
  "tohit",
  "ac",
  "savingthrow",
  "bonusaction",
  "reaction",
  "attackroll",
  "damage",
  "critical",
  "crit",
  "miss",
  "hit",
]);

const MEDIUM_COMBAT_TOKENS = new Set([
  "attack",
  "cast",
  "target",
  "enemy",
]);

const GENERIC_ROLL_TOKENS = new Set([
  "roll",
  "check",
  "d20",
  "advantage",
  "disadvantage",
]);

// Combat-paired cues (make "roll" count as combat)
const COMBAT_ROLL_CUES = new Set([
  "initiative",
  "tohit",
  "attack",
  "damage",
  "ac",
  "save",
  "saving",
  "savingthrow",
  "round",
  "turn",
  "turnorder",
]);

// Skill names (when paired with "roll", indicates non-combat)
const SKILL_NAMES = new Set([
  "perception",
  "investigation",
  "insight",
  "persuasion",
  "deception",
  "intimidation",
  "performance",
  "acrobatics",
  "athletics",
  "sleightofhand",
  "stealth",
  "arcana",
  "history",
  "nature",
  "religion",
  "animalhandling",
  "medicine",
  "survival",
]);

const HARD_WEIGHT = 4;
const MEDIUM_WEIGHT = 2;
const GENERIC_WEIGHT = 0.25;
const DISTINCTNESS_MULTIPLIER = 0.15;
const MAX_DISTINCTNESS_BONUS = 2.0;

function normalizeToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, "")
    .replace(/'+/g, "'")
    .replace(/^'+|'+$/g, "");
}

function tokenizeSimple(text: string): string[] {
  return text
    .split(/\s+/g)
    .map((t) => normalizeToken(t))
    .filter((t) => t.length > 0);
}

function sliceChunkLines(
  transcript: TranscriptEntry[],
  startIndex: number,
  endIndex: number
): TranscriptEntry[] {
  const start = Math.max(0, startIndex);
  const end = Math.min(endIndex, transcript.length - 1);
  return transcript.slice(start, end + 1);
}

export function calculatePlayerAlternationRate(lines: TranscriptEntry[]): number {
  if (lines.length === 0) return 0;

  const speakerNames = Array.from(new Set(lines.map((l) => l.author_name)));
  const detectedDm = detectDmSpeaker(speakerNames);
  const dmNames = buildDmNameSet(detectedDm);

  let switches = 0;
  let prevSpeaker: string | null = null;
  let prevIsDm: boolean | null = null;

  for (const line of lines) {
    const isDm = isDmSpeaker(line.author_name, dmNames);

    if (
      prevSpeaker !== null &&
      line.author_name !== prevSpeaker &&
      !isDm &&
      prevIsDm === false
    ) {
      switches += 1;
    }

    prevSpeaker = line.author_name;
    prevIsDm = isDm;
  }

  return switches / lines.length;
}

export function calculateCombatStats(lines: TranscriptEntry[]): {
  combatTokens: number;
  totalTokens: number;
  density: number;
  combatScore: number;
  distinctHardTypes: number;
} {
  let combatScore = 0;
  let totalTokens = 0;
  const distinctHardTypesSet = new Set<string>();

  for (const line of lines) {
    const content = line.content.toLowerCase();
    const tokens = tokenizeSimple(content);
    totalTokens += tokens.length;

    const tokensSet = new Set(tokens);
    let lineScore = 0;

    // Check for skill-paired roll (non-combat)
    const hasRoll = tokensSet.has("roll");
    const hasSkill = Array.from(tokensSet).some((t) => SKILL_NAMES.has(t));
    const isSkillCheck = hasRoll && hasSkill;

    // Check for combat-paired roll
    const hasCombatCue = Array.from(tokensSet).some((t) => COMBAT_ROLL_CUES.has(t));
    const isCombatRoll = hasRoll && hasCombatCue;

    // Score hard combat tokens
    for (const token of tokens) {
      if (HARD_COMBAT_TOKENS.has(token)) {
        lineScore += HARD_WEIGHT;
        distinctHardTypesSet.add(token);
      } else if (MEDIUM_COMBAT_TOKENS.has(token)) {
        lineScore += MEDIUM_WEIGHT;
      } else if (GENERIC_ROLL_TOKENS.has(token)) {
        // Only count generic roll tokens if combat-paired and NOT skill-paired
        if (isCombatRoll && !isSkillCheck) {
          lineScore += GENERIC_WEIGHT;
        }
      }
    }

    combatScore += lineScore;
  }

  const numLines = lines.length > 0 ? lines.length : 1;
  const distinctHardTypes = distinctHardTypesSet.size;
  const distinctnessBonus = Math.min(
    1 + DISTINCTNESS_MULTIPLIER * distinctHardTypes,
    MAX_DISTINCTNESS_BONUS
  );
  const rawDensity = combatScore / numLines;
  const density = rawDensity * distinctnessBonus;

  // Legacy combatTokens approximation (sum of hard tokens for backward compat)
  const combatTokens = Array.from(distinctHardTypesSet).length;

  return {
    combatTokens,
    totalTokens,
    density,
    combatScore,
    distinctHardTypes,
  };
}

export function calculateCombatDensity(lines: TranscriptEntry[]): number {
  return calculateCombatStats(lines).density;
}

function hasStartAnchor(lines: TranscriptEntry[]): boolean {
  for (const line of lines) {
    for (const pattern of COMBAT_START_PATTERNS) {
      if (pattern.test(line.content)) {
        return true;
      }
    }
  }
  return false;
}

function hasEndAnchor(lines: TranscriptEntry[]): boolean {
  for (const line of lines) {
    for (const pattern of COMBAT_END_PATTERNS) {
      if (pattern.test(line.content)) {
        return true;
      }
    }
  }
  return false;
}

type ChunkCombatInfo = {
  chunk: RegimeChunk;
  lines: TranscriptEntry[];
  has_start_anchor: boolean;
  has_end_anchor: boolean;
  combat_tokens: number;
  combat_density: number;
  combat_score: number;
  distinct_hard_types: number;
  combat: boolean;
  smoothed_by?: string;
  state_transition?: string;
};

export function generateRegimeMasks(
  chunks: RegimeChunk[],
  transcript: TranscriptEntry[],
  opts: RegimeMaskOptions = {}
): RegimeMasks {
  const alternationThreshold =
    opts.alternationThreshold ?? DEFAULT_ALTERNATION_THRESHOLD;
  const combatDensityThreshold =
    opts.combatDensityThreshold ?? DEFAULT_COMBAT_DENSITY_THRESHOLD;
  const combatDensityLow = opts.combatDensityLow ?? DEFAULT_COMBAT_DENSITY_LOW;
  const debugCombat = opts.debugCombat === true;

  const oocHard: Span[] = [];
  const oocSoft: Span[] = [];

  // Pass A: Detect anchors and compute chunk combat info
  const chunkInfos: ChunkCombatInfo[] = chunks.map((chunk) => {
    const lines = sliceChunkLines(transcript, chunk.start_index, chunk.end_index);
    const combatStats = calculateCombatStats(lines);
    const has_start = hasStartAnchor(lines);
    const has_end = hasEndAnchor(lines);
    
    // Seed combat if anchors present OR strong density/tokens
    const seed_combat = 
      has_start || 
      combatStats.combatTokens >= MIN_TOKENS_SEED || 
      combatStats.density >= T_SEED;

    return {
      chunk,
      lines,
      has_start_anchor: has_start,
      has_end_anchor: has_end,
      combat_tokens: combatStats.combatTokens,
      combat_density: combatStats.density,
      combat_score: combatStats.combatScore,
      distinct_hard_types: combatStats.distinctHardTypes,
      combat: seed_combat,
    };
  });

  // Pass B: State machine walk (OUT → IN on start anchor, IN → OUT on end anchor)
  let state: "OUT" | "IN" = "OUT";
  for (let i = 0; i < chunkInfos.length; i++) {
    const info = chunkInfos[i];
    const prevState = state;

    if (state === "OUT" && info.has_start_anchor) {
      state = "IN";
      info.combat = true;
      info.state_transition = "OUT→IN";
    } else if (state === "IN" && info.has_end_anchor) {
      info.combat = true; // End chunk is still combat
      info.state_transition = "IN→OUT";
      state = "OUT";
    } else if (state === "IN") {
      info.combat = true;
    } else if (state === "OUT") {
      // If seeded by density but no anchor context, leave as-is
      // (could be false positive)
      if (!info.has_start_anchor && info.combat) {
        // Keep seed if strong enough
        if (info.combat_tokens < MIN_TOKENS_SEED && info.combat_density < T_SEED) {
          info.combat = false;
        }
      }
    }
  }

  // Pass C: Smoothing - fill single non-combat gaps between combat chunks
  for (let i = 1; i < chunkInfos.length - 1; i++) {
    if (
      !chunkInfos[i].combat &&
      chunkInfos[i - 1].combat &&
      chunkInfos[i + 1].combat
    ) {
      chunkInfos[i].combat = true;
      chunkInfos[i].smoothed_by = "S1 (gap-fill)";
    }
  }

  // Debug output
  if (debugCombat) {
    console.log("\n=== Combat Detection Debug (Weighted Scoring) ===");
    for (const info of chunkInfos) {
      const flags = [];
      if (info.has_start_anchor) flags.push("START_ANCHOR");
      if (info.has_end_anchor) flags.push("END_ANCHOR");
      if (info.state_transition) flags.push(info.state_transition);
      if (info.smoothed_by) flags.push(info.smoothed_by);
      
      const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
      const combatStr = info.combat ? "COMBAT" : "OUT";
      
      console.log(
        `${info.chunk.chunk_id}: ${combatStr} ` +
        `score=${info.combat_score.toFixed(1)} density=${info.combat_density.toFixed(4)} ` +
        `distinct=${info.distinct_hard_types}${flagStr}`
      );
    }
    console.log("==============================\n");
  }

  // Build OOC masks
  for (const chunk of chunks) {
    const lines = sliceChunkLines(transcript, chunk.start_index, chunk.end_index);
    const alternationRate = calculatePlayerAlternationRate(lines);
    const combatStats = calculateCombatStats(lines);

    if (chunk.is_ooc) {
      oocHard.push({
        start_index: chunk.start_index,
        end_index: chunk.end_index,
        reason: "ooc_hard",
        chunk_id: chunk.chunk_id,
        chunk_index: chunk.chunk_index,
      });
    }

    if (alternationRate > alternationThreshold && combatStats.density <= combatDensityLow) {
      oocSoft.push({
        start_index: chunk.start_index,
        end_index: chunk.end_index,
        reason: "ooc_soft",
        chunk_id: chunk.chunk_id,
        chunk_index: chunk.chunk_index,
      });
    }
  }

  // Build combat spans from final chunk decisions
  const combat: Span[] = [];
  for (const info of chunkInfos) {
    if (info.combat) {
      combat.push({
        start_index: info.chunk.start_index,
        end_index: info.chunk.end_index,
        reason: info.smoothed_by || (info.has_start_anchor || info.has_end_anchor ? "anchor" : "density"),
        chunk_id: info.chunk.chunk_id,
        chunk_index: info.chunk.chunk_index,
      });
    }
  }

  return { oocHard, oocSoft, combat };
}
