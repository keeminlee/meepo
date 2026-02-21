import type { TranscriptEntry } from "../ledger/transcripts.js";
import { tokenizeKeywords } from "./textFeatures.js";

export function buildIdf(lines: TranscriptEntry[]): Map<string, number> {
  const docCount = lines.length;
  const df = new Map<string, number>();

  for (const line of lines) {
    const tokens = tokenizeKeywords(line.content);
    for (const token of tokens) {
      df.set(token, (df.get(token) ?? 0) + 1);
    }
  }

  const idf = new Map<string, number>();
  for (const [token, freq] of df.entries()) {
    const value = Math.log((docCount + 1) / (freq + 1)) + 1;
    idf.set(token, value);
  }

  return idf;
}

/**
 * Calibrate lexical saturation constant k from session-local overlap distribution.
 * Samples candidate edges and computes 75th percentile of nonzero lexical scores.
 * @param lines - transcript lines
 * @param idf - precomputed IDF map
 * @param maxBack - maximum lookback distance
 * @param sampleSize - max candidates to sample per consequence line
 * @returns calibrated k value (fallback 6 if no nonzero overlaps)
 */
export function calibrateLexK(
  lines: TranscriptEntry[],
  idf: Map<string, number>,
  maxBack: number,
  sampleSize = 50
): number {
  const rawScores: number[] = [];

  // Sample DM lines as consequence candidates
  const dmLines = lines.filter((line) => line.author_name.toLowerCase().includes("dm"));
  
  for (const cons of dmLines.slice(0, sampleSize)) {
    const consTokens = tokenizeKeywords(cons.content);
    
    // Look back for potential intent lines
    for (let i = Math.max(0, cons.line_index - maxBack); i < cons.line_index; i++) {
      const intentLine = lines.find((l) => l.line_index === i);
      if (!intentLine || intentLine.author_name.toLowerCase().includes("dm")) continue;

      const intentTokens = tokenizeKeywords(intentLine.content);
      const sharedTerms = Array.from(intentTokens).filter((token) => consTokens.has(token));
      
      if (sharedTerms.length > 0) {
        const lexScore = sharedTerms.reduce((sum, token) => sum + (idf.get(token) ?? 1), 0);
        rawScores.push(lexScore);
      }
    }
  }

  if (rawScores.length === 0) return 6; // fallback

  rawScores.sort((a, b) => a - b);
  const p75Index = Math.floor(rawScores.length * 0.75);
  return rawScores[p75Index] || 6;
}

