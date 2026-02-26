import type { IntentType } from "./types.js";

export type IntentDetection = {
  isIntent: boolean;
  intent_type: IntentType;
  strongIntent: boolean;
  weakIntent: boolean;
};

export type CauseType = IntentType;

export type CauseDetection = {
  isCause: boolean;
  cause_type: CauseType;
  mass: number;
};

// Question starter phrases that indicate strong intent when combined with action verbs/question marks
const STRONG_QUESTION_STARTERS = [
  "can i",
  "can we",
  "do i",
  "do we",
  "is there",
  "are there",
  "what do i",
  "what do we",
  "how do i",
  "where is",
  "does it look",
  "did it look",
  "could i",
  "could we",
  "would i be able to",
  "what if i",
  "what if we",
];

// Build STRONG_QUESTION_START regex dynamically from STRONG_QUESTION_STARTERS
const STRONG_QUESTION_START = new RegExp(
  `^\\s*(${STRONG_QUESTION_STARTERS.map(phrase => phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join("|")})\\b`,
  "i"
);

const ACTION_VERBS = new Set([
  "try",
  "attempt",
  "search",
  "examine",
  "inspect",
  "look",
  "open",
  "pull",
  "push",
  "take",
  "grab",
  "move",
  "touch",
  "cast",
  "read",
  "listen",
  "sneak",
  "hide",
  "pick",
  "investigate",
  "attack",
  "cast",
  "use",
  "roll",
  "check",
]);

// "Insight check!", "Perception check", etc. — explicit request to roll a skill
const SKILL_NAMES =
  "insight|perception|athletics|acrobatics|arcana|deception|history|intimidation|investigation|medicine|nature|performance|persuasion|religion|stealth|survival|animal handling|sleight of hand";
const SKILL_CHECK_INTENT = new RegExp(`\\b(${SKILL_NAMES})\\s+check\\b`, "i");
// Just "Insight!" or "Perception." at end of line (short call-out to roll)
const SKILL_CALLOUT_INTENT = new RegExp(`^\\s*(${SKILL_NAMES})\\s*[!.]?\\s*$`, "i");
// Liberal L1 recall: any mention of a skill name in the line counts as intent (lower precision, strength/tier filter later)
const SKILL_NAMES_FOR_ANYWHERE =
  "insight|perception|athletics|acrobatics|arcana|deception|history|intimidation|investigation|medicine|nature|performance|persuasion|religion|stealth|survival|animal\\s+handling|sleight\\s+of\\s+hand";
const SKILL_NAME_ANYWHERE = new RegExp(`\\b(${SKILL_NAMES_FOR_ANYWHERE})\\b`, "i");

const REQUEST_PATTERNS: Array<{ type: IntentType; pattern: RegExp }> = [
  { type: "request", pattern: /^\s*(can i|can we|may i|could i|could we|would i|would i be able to)\b/i },
  { type: "request", pattern: /^\s*(i want to|i'd like to|i would like to|i'm going to|i am going to|i kind of want to|i sorta want to)\b/i },
];

// Build DECLARE_PATTERNS dynamically from ACTION_VERBS
const DECLARE_PATTERNS: Array<{ type: IntentType; pattern: RegExp }> = [
  { 
    type: "declare", 
    pattern: new RegExp(`^\\s*i\\s+(${Array.from(ACTION_VERBS).join("|")})\\b`, "i") 
  },
];

const WEAK_INTENT_PATTERNS: Array<{ type: IntentType; pattern: RegExp }> = [
  { type: "question", pattern: /\?/ }, // catches inline and trailing questions
  { type: "request", pattern: /\bplease\b/i },
  { type: "propose", pattern: /^\s*(let's|we should|we could|how about)\b/i },
];

function stripPunctuation(text: string): string {
  return text.replace(/[^a-z0-9\s]/gi, "").trim();
}

function countWords(text: string): number {
  if (!text) return 0;
  return text.split(/\s+/g).filter(Boolean).length;
}

function hasActionVerbWithin(text: string, maxDistance: number): boolean {
  const tokens = stripPunctuation(text).toLowerCase().split(/\s+/g).filter(Boolean);
  const limit = Math.min(tokens.length, maxDistance + 1);
  for (let i = 0; i < limit; i++) {
    if (ACTION_VERBS.has(tokens[i])) return true;
  }
  return false;
}

export function detectIntent(text: string): IntentDetection {
  const cause = detectCause(text);
  if (!cause.isCause) {
    return { isIntent: false, intent_type: "declare", strongIntent: false, weakIntent: false };
  }

  // Single mass for all causes (no inflation by type); strength/tier filter later
  return {
    isIntent: true,
    intent_type: cause.cause_type,
    strongIntent: true,
    weakIntent: false,
  };
}

export function detectCause(text: string): CauseDetection {
  const stripped = stripPunctuation(text);

  // Single leaf mass for all causes (no inflation by type)
  const LEAF_MASS = 1;

  if (SKILL_CHECK_INTENT.test(text)) {
    return { isCause: true, cause_type: "request", mass: LEAF_MASS };
  }
  if (SKILL_CALLOUT_INTENT.test(text)) {
    return { isCause: true, cause_type: "request", mass: LEAF_MASS };
  }

  if (stripped.length < 6) {
    return { isCause: false, cause_type: "declare", mass: 0 };
  }

  const wordCount = countWords(stripped);

  if (STRONG_QUESTION_START.test(text)) {
    const hasAction = hasActionVerbWithin(text, 6);
    const hasQuestionMark = /\?\s*$/.test(text);
    if (hasQuestionMark || wordCount >= 4 || hasAction) {
      return { isCause: true, cause_type: "question", mass: LEAF_MASS };
    }
  }

  for (const entry of REQUEST_PATTERNS) {
    if (entry.pattern.test(text)) {
      if (hasActionVerbWithin(text, 3)) {
        return { isCause: true, cause_type: entry.type, mass: LEAF_MASS };
      }
    }
  }

  for (const entry of DECLARE_PATTERNS) {
    if (entry.pattern.test(text)) {
      if (wordCount >= 4) {
        return { isCause: true, cause_type: entry.type, mass: LEAF_MASS };
      }
    }
  }

  for (const entry of WEAK_INTENT_PATTERNS) {
    if (entry.pattern.test(text)) {
      return { isCause: true, cause_type: entry.type, mass: LEAF_MASS };
    }
  }

  if (SKILL_NAME_ANYWHERE.test(text)) {
    return { isCause: true, cause_type: "request", mass: LEAF_MASS };
  }

  return { isCause: false, cause_type: "declare", mass: 0 };
}
