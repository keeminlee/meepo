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

  return {
    isIntent: true,
    intent_type: cause.cause_type,
    strongIntent: cause.mass >= 0.7,
    weakIntent: cause.mass < 0.7,
  };
}

export function detectCause(text: string): CauseDetection {
  const stripped = stripPunctuation(text);
  if (stripped.length < 6) {
    return { isCause: false, cause_type: "declare", mass: 0 };
  }

  const wordCount = countWords(stripped);

  const hasRollOrActionKeyword = /\b(roll|check|attack|cast|spell|investigate|inspect|search|open|unlock|sneak|hide|persuade|deceive)\b/i.test(text);

  if (STRONG_QUESTION_START.test(text)) {
    const hasAction = STRONG_QUESTION_START.test(text)
      ? hasActionVerbWithin(text, 6)
      : false;
    const hasQuestionMark = /\?\s*$/.test(text);
    if (hasQuestionMark || wordCount >= 4 || hasAction) {
      const mass = hasRollOrActionKeyword || hasAction ? 0.9 : 0.75;
      return { isCause: true, cause_type: "question", mass };
    }
  }

  for (const entry of REQUEST_PATTERNS) {
    if (entry.pattern.test(text)) {
      const hasAction = hasActionVerbWithin(text, 3);
      if (hasAction) {
        const mass = hasRollOrActionKeyword ? 0.95 : 0.85;
        return { isCause: true, cause_type: entry.type, mass };
      }
    }
  }

  for (const entry of DECLARE_PATTERNS) {
    if (entry.pattern.test(text)) {
      if (wordCount >= 4) {
        const mass = hasRollOrActionKeyword ? 1.0 : 0.9;
        return { isCause: true, cause_type: entry.type, mass };
      }
    }
  }

  for (const entry of WEAK_INTENT_PATTERNS) {
    if (entry.pattern.test(text)) {
      const mass = hasRollOrActionKeyword ? 0.65 : 0.45;
      return { isCause: true, cause_type: entry.type, mass };
    }
  }

  return { isCause: false, cause_type: "declare", mass: 0 };
}
