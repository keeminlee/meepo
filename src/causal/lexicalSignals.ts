/**
 * Lever-regime lexical signals:
 * - rarity-weighted lexical overlap (IDF-like)
 * - keyword-overlap signal for cause/effect trigger lexemes
 */

export type LexicalCorpusStats = {
  docCount: number;
  dfByToken: Map<string, number>;
};

// Detection-oriented keyword lexemes (intent/effect triggers)
const DETECTION_KEYWORDS = new Set([
  "can", "could", "would", "may", "how", "what", "where", "is", "are", "do", "does", "did",
  "try", "attempt", "search", "examine", "inspect", "look", "open", "pull", "push", "take",
  "grab", "move", "touch", "cast", "read", "listen", "sneak", "hide", "pick", "investigate",
  "attack", "use", "roll", "check", "please",
  "insight", "perception", "athletics", "acrobatics", "arcana", "deception", "history",
  "intimidation", "medicine", "nature", "performance", "persuasion", "religion", "stealth",
  "survival", "animal", "handling", "sleight", "hand",
  "you", "see", "notice", "find", "learn", "realize", "spot", "smell", "hear", "feel",
  "remember", "recognize", "discover", "seems", "looks", "appears",
  "succeed", "fail", "manage", "force", "break", "works", "stuck", "blocked",
  "agree", "promise", "commit", "decide", "will",
]);

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 2);
}

export function scoreTokenOverlapSimple(text1: string, text2: string): number {
  const tokens1 = new Set(tokenize(text1));
  const tokens2 = new Set(tokenize(text2));
  if (tokens1.size === 0 || tokens2.size === 0) return 0;
  const overlap = Array.from(tokens1).filter((t) => tokens2.has(t)).length;
  return overlap / Math.max(tokens1.size, tokens2.size);
}

export function buildLexicalCorpusStats(texts: string[]): LexicalCorpusStats {
  const dfByToken = new Map<string, number>();
  for (const text of texts) {
    const unique = new Set(tokenize(text));
    for (const tok of unique) {
      dfByToken.set(tok, (dfByToken.get(tok) ?? 0) + 1);
    }
  }
  return { docCount: Math.max(1, texts.length), dfByToken };
}

function idfWeight(token: string, stats: LexicalCorpusStats): number {
  const df = stats.dfByToken.get(token) ?? 0;
  // Smoothed IDF >= 1
  return Math.log((stats.docCount + 1) / (df + 1)) + 1;
}

export function lexicalSignals(
  text1: string,
  text2: string,
  stats?: LexicalCorpusStats,
): { lexicalScore: number; keywordOverlap: number } {
  const a = new Set(tokenize(text1));
  const b = new Set(tokenize(text2));
  if (a.size === 0 || b.size === 0) return { lexicalScore: 0, keywordOverlap: 0 };

  const overlap = new Set(Array.from(a).filter((t) => b.has(t)));
  if (overlap.size === 0) return { lexicalScore: 0, keywordOverlap: 0 };

  if (!stats) {
    const lexicalScore = overlap.size / Math.max(a.size, b.size);
    const kwOverlap = Array.from(overlap).filter((t) => DETECTION_KEYWORDS.has(t)).length;
    const keywordOverlap = kwOverlap / overlap.size;
    return { lexicalScore, keywordOverlap };
  }

  const union = new Set<string>([...a, ...b]);
  let overlapW = 0;
  let unionW = 0;
  let overlapKwW = 0;
  for (const tok of union) {
    const w = idfWeight(tok, stats);
    unionW += w;
    if (overlap.has(tok)) {
      overlapW += w;
      if (DETECTION_KEYWORDS.has(tok)) overlapKwW += w;
    }
  }
  const lexicalScore = unionW > 0 ? overlapW / unionW : 0;
  const keywordOverlap = overlapW > 0 ? overlapKwW / overlapW : 0;
  return { lexicalScore, keywordOverlap };
}

