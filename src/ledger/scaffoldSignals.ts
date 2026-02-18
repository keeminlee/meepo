/**
 * scaffoldSignals.ts
 *
 * Regex pattern catalogue for DM transition / framing signal detection.
 *
 * All patterns are matched case-insensitively against the DM line text.
 * Add or tune patterns here to improve scaffold boundary quality.
 */

import type { SignalCategory, SignalHit } from "./scaffoldTypes.js";

export interface PatternEntry {
  /** Human-readable display name (used in signal_hits output) */
  name: string;
  pattern: RegExp;
  category: SignalCategory;
  /** Confidence contribution of this single signal (0–1) */
  confidence: number;
}

// ── Pattern catalogue ─────────────────────────────────────────────────────────

export const SIGNAL_PATTERNS: PatternEntry[] = [
  // ----------------------------------------------------------------
  // HARD CUTS — unambiguous scene transitions
  // ----------------------------------------------------------------
  { name: "cut_to",       pattern: /\bcut(?:ting)?\s+to\b/i,              category: "hard_cut", confidence: 0.95 },
  { name: "meanwhile",    pattern: /\bmeanwhile\b/i,                       category: "hard_cut", confidence: 0.90 },
  { name: "elsewhere",    pattern: /\belsewhere\b/i,                       category: "hard_cut", confidence: 0.85 },
  { name: "we_cut",       pattern: /\bwe\s+(?:now\s+)?cut\b/i,             category: "hard_cut", confidence: 0.90 },
  { name: "scene_change",  pattern: /\bscene\s+(?:transition|change|shift)\b/i, category: "hard_cut", confidence: 0.90 },
  { name: "back_to",      pattern: /\bback\s+to\b/i,                      category: "hard_cut", confidence: 0.75 },

  // ----------------------------------------------------------------
  // TIME SKIPS — temporal jumps
  // ----------------------------------------------------------------
  { name: "next_morning",     pattern: /\bnext\s+morning\b/i,                  category: "time_skip", confidence: 0.90 },
  { name: "later_that",       pattern: /\blater\s+that\b/i,                    category: "time_skip", confidence: 0.85 },
  { name: "hours_later",      pattern: /\bhours?\s+later\b/i,                  category: "time_skip", confidence: 0.90 },
  { name: "days_later",       pattern: /\bdays?\s+later\b/i,                   category: "time_skip", confidence: 0.90 },
  { name: "skip_ahead",       pattern: /\bskip(?:ping)?\s+ahead\b/i,           category: "time_skip", confidence: 0.90 },
  { name: "fast_forward",     pattern: /\bfast\s+forward\b/i,                  category: "time_skip", confidence: 0.85 },
  { name: "time_passes",      pattern: /\btime\s+pass(?:es|ing)?\b/i,          category: "time_skip", confidence: 0.80 },
  { name: "some_time_later",  pattern: /\bsome\s+time\s+later\b/i,             category: "time_skip", confidence: 0.85 },
  { name: "after_a_while",    pattern: /\bafter\s+a\s+while\b/i,               category: "time_skip", confidence: 0.70 },
  { name: "the_next",         pattern: /\bthe\s+next\s+(?:day|morning|night|evening|hour)\b/i, category: "time_skip", confidence: 0.85 },

  // ----------------------------------------------------------------
  // SCENE FRAMING — DM establishing a scene
  // ----------------------------------------------------------------
  { name: "you_see",       pattern: /\byou\s+(?:all\s+)?(?:now\s+)?see\b/i,   category: "scene_set", confidence: 0.75 },
  { name: "you_notice",    pattern: /\byou\s+(?:all\s+)?notice\b/i,           category: "scene_set", confidence: 0.70 },
  { name: "you_find",      pattern: /\byou\s+(?:all\s+)?find\s+yoursel/i,     category: "scene_set", confidence: 0.80 },
  { name: "as_you_enter",  pattern: /\bas\s+you\s+(?:enter|step|walk|emerge|approach)\b/i, category: "scene_set", confidence: 0.85 },
  { name: "you_arrive",    pattern: /\byou\s+(?:all\s+)?arrive\b/i,           category: "scene_set", confidence: 0.80 },
  { name: "you_are_escorted", pattern: /\byou(?:'re|\s+are)\s+escorted\b/i,   category: "scene_set", confidence: 0.85 },
  { name: "before_you",    pattern: /\bbefore\s+you\b/i,                      category: "scene_set", confidence: 0.65 },
  { name: "the_room",      pattern: /\bthe\s+room\s+(?:is|looks|appears|smells|feels)\b/i, category: "scene_set", confidence: 0.70 },
  { name: "the_area",      pattern: /\bthe\s+(?:area|space|chamber|hall|hallway|corridor)\b/i, category: "scene_set", confidence: 0.60 },
  { name: "describe_scene", pattern: /\b(?:begin(?:s)?\s+)?(?:a\s+)?new\s+scene\b/i, category: "scene_set", confidence: 0.85 },
  { name: "we_begin",      pattern: /\bwe\s+begin\s+(?:our|this|the)\b/i,     category: "scene_set", confidence: 0.80 },
  { name: "our_scene",     pattern: /\bour\s+(?:next\s+)?scene\b/i,           category: "scene_set", confidence: 0.85 },

  // ----------------------------------------------------------------
  // INITIATIVE / COMBAT START
  // ----------------------------------------------------------------
  { name: "roll_initiative", pattern: /\broll\s+(?:for\s+)?initiative\b/i,    category: "initiative", confidence: 0.98 },
  { name: "combat_begins",   pattern: /\bcombat\s+(?:begins|starts|initiates)\b/i, category: "initiative", confidence: 0.95 },
  { name: "roll_perception", pattern: /\broll\s+(?:a\s+)?perception\b/i,      category: "initiative", confidence: 0.55 },

  // ----------------------------------------------------------------
  // PHASE CHANGES — rest, combat end, new phase
  // ----------------------------------------------------------------
  { name: "short_rest",     pattern: /\bshort\s+rest\b/i,                    category: "phase_change", confidence: 0.90 },
  { name: "long_rest",      pattern: /\blong\s+rest\b/i,                     category: "phase_change", confidence: 0.90 },
  { name: "combat_ends",    pattern: /\bcombat\s+(?:is\s+over|ends|ended|concludes)\b/i, category: "phase_change", confidence: 0.90 },
  { name: "end_of_round",   pattern: /\bend\s+of\s+(?:the\s+)?round\b/i,     category: "phase_change", confidence: 0.85 },
  { name: "top_of_round",   pattern: /\btop\s+of\s+(?:the\s+)?round\b/i,     category: "phase_change", confidence: 0.80 },
  { name: "new_round",      pattern: /\bnew\s+round\b/i,                     category: "phase_change", confidence: 0.80 },
  { name: "level_up",       pattern: /\blevel(?:\s+up)?\b/i,                 category: "phase_change", confidence: 0.55 },
  { name: "session_ends",   pattern: /\bsession\s+(?:is\s+)?over\b|\bend\s+(?:of\s+)?(?:the\s+)?session\b/i, category: "phase_change", confidence: 0.90 },
  { name: "session_recap",  pattern: /\blast\s+(?:time|session|week)\b/i,    category: "phase_change", confidence: 0.75 },

  // ----------------------------------------------------------------
  // OOC signals
  // ----------------------------------------------------------------
  { name: "bathroom_break", pattern: /\bbathroom\b|\bbrb\b|\bbreak\s+time\b/i, category: "ooc", confidence: 0.85 },
  { name: "rules_check",    pattern: /\brules?\s+(?:check|question|wise|lawyer)\b|\bhow\s+does\s+that\s+work\b/i, category: "ooc", confidence: 0.70 },
  { name: "good_game",      pattern: /\bgood\s+(?:game|session|night)\b/i,   category: "ooc", confidence: 0.80 },

  // ----------------------------------------------------------------
  // SOFT CONFIRMATIONS — lower-confidence DM openers
  // ----------------------------------------------------------------
  { name: "okay_so",       pattern: /^(?:okay|ok|alright|all\s+right)[,.]?\s+so\b/i,  category: "soft_confirm", confidence: 0.40 },
  { name: "alright_then",  pattern: /^(?:alright|all\s+right)[,.]?\s+then\b/i,        category: "soft_confirm", confidence: 0.40 },
  { name: "with_that",     pattern: /^(?:and\s+)?with\s+that\b/i,                     category: "soft_confirm", confidence: 0.45 },
  { name: "as_a_result",   pattern: /^as\s+a\s+result\b/i,                            category: "soft_confirm", confidence: 0.45 },
];

// ── Detector ─────────────────────────────────────────────────────────────────

/**
 * Run all signal patterns against a line of text.
 * Returns all matching SignalHits (may be empty).
 */
export function detectSignals(text: string): SignalHit[] {
  const hits: SignalHit[] = [];
  for (const entry of SIGNAL_PATTERNS) {
    if (entry.pattern.test(text)) {
      hits.push({
        pattern: entry.name,
        category: entry.category,
        confidence: entry.confidence,
      });
    }
  }
  return hits;
}

/**
 * Aggregate multiple signal hits into a single confidence score.
 * Uses max + small bonus for multiple hits (capped at 1.0).
 */
export function aggregateConfidence(hits: SignalHit[]): number {
  if (hits.length === 0) return 0;
  const max = Math.max(...hits.map((h) => h.confidence));
  const bonus = Math.min(0.1, (hits.length - 1) * 0.03);
  return Math.min(1.0, max + bonus);
}
