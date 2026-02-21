export const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "to", "of", "in", "on", "for", "with",
  "at", "by", "from", "up", "down", "out", "over", "under", "again", "further",
  "then", "once", "here", "there", "when", "where", "why", "how", "all", "any",
  "both", "each", "few", "more", "most", "other", "some", "such", "no", "nor",
  "not", "only", "own", "same", "so", "than", "too", "very", "can", "will",
  "just", "don", "should", "now", "you", "your", "yours", "we", "our", "ours",
  "i", "me", "my", "mine", "they", "them", "their", "theirs", "he", "him",
  "his", "she", "her", "hers", "it", "its", "is", "are", "was", "were", "be",
  "been", "being", "do", "does", "did", "have", "has", "had", "what", "if",
  "this", "that", "these", "those", "as", "into", "about", "maybe", "could",
  "would", "able", "like", "want", "kind", "sorta"
]);

export const DOMAIN_STOPWORDS = new Set([
  "roll",
  "rolling",
  "check",
  "dice",
  "d20",
  "advantage",
  "disadvantage",
]);

export function normalizeName(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "")
    .replace(/\s+/g, " ");
}

export function normalizeToken(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, "")
    .replace(/'+/g, "'")
    .replace(/^'+|'+$/g, "");
}

export function tokenizeKeywords(text: string): Set<string> {
  const tokens = text
    .split(/\s+/g)
    .map((token) => normalizeToken(token))
    .filter(
      (token) =>
        token.length >= 3 &&
        !STOPWORDS.has(token) &&
        !DOMAIN_STOPWORDS.has(token)
    );

  return new Set(tokens);
}

export function countOverlap(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const token of a) {
    if (b.has(token)) count += 1;
  }
  return count;
}

export function hasAnswerForm(text: string): boolean {
  return /\b(you see|you notice|you find|it looks|there is|there are|you can|you cannot|you're able|you spot)\b/i.test(text);
}

export function isYesNoAnswerLike(text: string): boolean {
  return /^\s*(yes|yeah|yep|yup|sure|okay|ok|no|nope|nah|not really|not at all|not exactly)/i.test(text);
}

const ACTION_VERB_STEMS = new Set([
  "aid", "help", "assist",
  "look", "inspect", "examine", "search", "check",
  "whisper", "talk", "speak", "say", "tell",
  "move", "go", "walk", "run",
  "grab", "take", "pick",
  "open", "close",
  "cast", "use",
  "attack", "hit", "strike",
]);

export function extractVerbStems(text: string): Set<string> {
  const stems = new Set<string>();
  const normalized = text.toLowerCase();

  for (const verb of ACTION_VERB_STEMS) {
    if (normalized.includes(verb)) stems.add(verb);
  }

  return stems;
}

export function sharesSimilarAction(text1: string, text2: string): boolean {
  const stems1 = extractVerbStems(text1);
  const stems2 = extractVerbStems(text2);

  if (stems1.size === 0 || stems2.size === 0) return false;

  for (const stem of stems1) {
    if (stems2.has(stem)) return true;
  }

  return false;
}

export function isHighValueIntent(intentText: string): boolean {
  const hasActionVerb = extractVerbStems(intentText).size > 0;
  const isLong = intentText.trim().length > 30;
  return hasActionVerb && isLong;
}

/**
 * Hill/rational distance scoring: hard early dropoff, plateau tail.
 * @param d - distance in lines
 * @param tau - half-max distance (default 6)
 * @param p - steepness exponent (default 2.2)
 * @returns score in (0, 1]
 */
export function distanceScoreHill(d: number, tau = 6, p = 2.2): number {
  if (d <= 0) return 1;
  return 1 / (1 + Math.pow(d / tau, p));
}

/**
 * Saturating transform to normalize lexical overlap into [0, 1].
 * @param L - raw lexical score (sum of IDF)
 * @param k - saturation constant
 * @returns normalized score in [0, 1)
 */
export function lexicalScore01(L: number, k: number): number {
  const x = Math.max(0, L);
  return x / (x + k);
}
