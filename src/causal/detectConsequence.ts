import type { ConsequenceType } from "./types.js";
import { detectRollType } from "./detectRoll.js";

export type ConsequenceDetection = {
  isConsequence: boolean;
  consequence_type: ConsequenceType;
  roll_type?: ReturnType<typeof detectRollType>["roll_type"];
  roll_subtype?: ReturnType<typeof detectRollType>["roll_subtype"] | null;
};

export type EffectType = Exclude<ConsequenceType, "none">;

export type EffectDetection = {
  isEffect: boolean;
  effect_type: EffectType;
  mass: number;
  roll_type?: ReturnType<typeof detectRollType>["roll_type"];
  roll_subtype?: ReturnType<typeof detectRollType>["roll_subtype"] | null;
};

const INFORMATION_PATTERNS = [
  /^\s*you\s+(see|notice|find|learn|realize|spot|smell|hear|feel|remember|recognize|discover)\b/i,
  /\byou (see|notice|find|learn|realize|spot|smell|hear|feel|remember|recognize|discover)\b/i,
  /\b(it seems|it looks like|it appears)\b/i,
  /^\s*(yes|no|not really|you don't|you do not|you can't|you cannot|you're able to)\b/i,
  /\byou can (see|do|try|attempt|make|roll)\b/i,
];

const DETERMINISTIC_PATTERNS = [
  /^\s*you\s+(open|move|pull|push|unlock|enter|walk|pick up|lift)\b/i,
  /\byou (succeed|fail|manage|push|force|open|break)\b/i,
  /\bthe door (opens|breaks|gives way)\b/i,
  /\bit (works|fails)\b/i,
  /\b(it won't budge|it doesn't budge|it is stuck|it is blocked)\b/i,
];

const COMMITMENT_PATTERNS = [
  /\byou (agree|promise|commit|decide)\b/i,
  /\bwe will\b/i,
];

export function detectConsequence(text: string): ConsequenceDetection {
  const effect = detectEffect(text);
  if (!effect.isEffect) {
    return { isConsequence: false, consequence_type: "none" };
  }

  return {
    isConsequence: true,
    consequence_type: effect.effect_type,
    roll_type: effect.roll_type,
    roll_subtype: effect.roll_subtype,
  };
}

export function detectEffect(text: string): EffectDetection {
  const roll = detectRollType(text);
  if (roll.roll_type) {
    return {
      isEffect: true,
      effect_type: "roll",
      mass: 1.0,
      roll_type: roll.roll_type,
      roll_subtype: roll.roll_subtype ?? null,
    };
  }

  if (INFORMATION_PATTERNS.some((pattern) => pattern.test(text))) {
    return { isEffect: true, effect_type: "information", mass: 0.7 };
  }

  if (DETERMINISTIC_PATTERNS.some((pattern) => pattern.test(text))) {
    return { isEffect: true, effect_type: "deterministic", mass: 0.85 };
  }

  if (COMMITMENT_PATTERNS.some((pattern) => pattern.test(text))) {
    return { isEffect: true, effect_type: "commitment", mass: 0.8 };
  }

  return { isEffect: false, effect_type: "other", mass: 0 };
}
