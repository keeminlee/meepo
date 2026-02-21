/**
 * LEGACY: v0 loop binding extractor (intent->consequence hard attachment).
 * Not used by graph pipeline. Retained only as baseline for debug-causal-loops.
 */
import { randomUUID } from "node:crypto";
import type { TranscriptEntry } from "../ledger/transcripts.js";
import { buildDmNameSet, detectDmSpeaker, isDmSpeaker } from "../ledger/scaffoldSpeaker.js";
import type { ConsequenceDetection } from "./detectConsequence.js";
import { detectConsequence } from "./detectConsequence.js";
import type { IntentDetection } from "./detectIntent.js";
import { detectIntent } from "./detectIntent.js";
import type { CausalLoop, IntentType, RollType } from "./types.js";
import type { RegimeMasks, RegimeChunk } from "./pruneRegimes.js";
import {
  normalizeName as featNormalizeName,
  tokenizeKeywords as featTokenizeKeywords,
  countOverlap as featCountOverlap,
  hasAnswerForm as featHasAnswerForm,
  isYesNoAnswerLike as featIsYesNoAnswerLike,
  extractVerbStems as featExtractVerbStems,
  sharesSimilarAction as featSharesSimilarAction,
  isHighValueIntent as featIsHighValueIntent,
} from "./textFeatures.js";
import {
  buildActorNameSet as featBuildActorNameSet,
  mentionsActor as featMentionsActor,
  getMentionedActors as featGetMentionedActors,
} from "./actorFeatures.js";

export type PcActor = {
  id: string;
  canonical_name: string;
  aliases: string[];
};

export type LoopExtractionOptions = {
  attachmentWindow?: number;
  lateBindWindow?: number;
  maxIntentGap?: number;
  excludeOocSoft?: boolean;
};

type ActiveIntent = {
  actor: PcActor;
  intent: IntentDetection;
  intentLineIndex: number;
  intentText: string;
};

const DEFAULT_ATTACHMENT_WINDOW = 15;
const DEFAULT_LATE_BIND_WINDOW = 15;
const DEFAULT_MAX_INTENT_GAP = 18; // Separate from binding: intents can persist longer

type DmConsequence = {
  lineIndex: number;
  text: string;
  detection: ConsequenceDetection;
  isDirect: boolean;
  keywords: Set<string>;
};

const STOPWORDS = new Set([
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

function normalizeName(text: string): string {
  return featNormalizeName(text);
}

function normalizeToken(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, "")
    .replace(/'+/g, "'")
    .replace(/^'+|'+$/g, "");
}

function tokenizeKeywords(text: string): Set<string> {
  return featTokenizeKeywords(text);
}

function buildActorNameSet(actor: PcActor): string[] {
  return featBuildActorNameSet(actor);
}

function matchPcSpeaker(speaker: string, actors: PcActor[]): PcActor | null {
  const normSpeaker = normalizeName(speaker);
  if (!normSpeaker) return null;

  let best: PcActor | null = null;
  let bestLen = 0;

  for (const actor of actors) {
    const names = buildActorNameSet(actor);
    for (const name of names) {
      if (!name) continue;
      if (normSpeaker === name || normSpeaker.includes(name)) {
        if (name.length > bestLen) {
          best = actor;
          bestLen = name.length;
        }
      }
    }
  }

  return best;
}

function mentionsActor(text: string, actor: PcActor): boolean {
  return featMentionsActor(text, actor);
}

function getMentionedActors(text: string, actors: PcActor[]): PcActor[] {
  return featGetMentionedActors(text, actors);
}

function isDirectDmResponse(text: string): boolean {
  return featIsYesNoAnswerLike(text);
}

function hasAnswerForm(text: string): boolean {
  return featHasAnswerForm(text);
}

function isQuestionLikeIntent(text: string): boolean {
  return /^\s*(can i|could i|would i|can we|could we|would we)\b/i.test(text);
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

function extractVerbStems(text: string): Set<string> {
  return featExtractVerbStems(text);
}

function sharesSimilarAction(text1: string, text2: string): boolean {
  return featSharesSimilarAction(text1, text2);
}

function isHighValueIntent(intentText: string): boolean {
  return featIsHighValueIntent(intentText);
}

function countOverlap(a: Set<string>, b: Set<string>): number {
  return featCountOverlap(a, b);
}

function loopKey(chunkId: string, actorId: string, intentLineIndex: number | null): string {
  return `${chunkId}:${actorId}:${intentLineIndex ?? "na"}`;
}

function applyConsequenceToLoop(
  loop: CausalLoop,
  intent: IntentDetection,
  intentLineIndex: number,
  consequence: DmConsequence,
  actorMentioned: boolean,
  overlapScore: number
): void {
  loop.consequence_type = consequence.detection.consequence_type;
  loop.roll_type = (consequence.detection.roll_type ?? null) as RollType;
  loop.roll_subtype = consequence.detection.roll_subtype ?? null;
  loop.outcome_text = consequence.text;
  loop.consequence_anchor_index = consequence.lineIndex;
  loop.end_index = consequence.lineIndex;

  const base = computeConfidence(
    intent,
    intentLineIndex,
    consequence.detection,
    consequence.lineIndex,
    actorMentioned,
    overlapScore,
    consequence.text
  );
  const overlapBonus = Math.min(0.2, overlapScore * 0.05);
  const directBonus = consequence.isDirect ? 0.05 : 0;
  loop.confidence = Math.min(1, base + overlapBonus + directBonus);
}

function isLineMasked(
  lineIndex: number,
  masks: RegimeMasks,
  excludeOocSoft: boolean
): boolean {
  for (const span of masks.oocHard) {
    if (lineIndex >= span.start_index && lineIndex <= span.end_index) return true;
  }
  if (excludeOocSoft) {
    for (const span of masks.oocSoft) {
      if (lineIndex >= span.start_index && lineIndex <= span.end_index) return true;
    }
  }
  for (const span of masks.combat) {
    if (lineIndex >= span.start_index && lineIndex <= span.end_index) return true;
  }
  return false;
}

function computeConfidence(
  intent: IntentDetection,
  intentLineIndex: number,
  consequence: ConsequenceDetection | null,
  consequenceLineIndex: number | null,
  actorMentioned: boolean,
  keywordOverlap?: number,
  dmText?: string
): number {
  // Start at 0.4 base for resolved loops
  let score = consequence ? 0.4 : 0.2;

  // Strong intent indicator
  if (intent.strongIntent) score += 0.05;
  
  // Roll requests are hard binds
  if (consequence?.consequence_type === "roll") score += 0.25;
  
  // Answer forms (you see, it looks, yes/no)
  if (dmText && hasAnswerForm(dmText)) score += 0.15;
  if (dmText && isDirectDmResponse(dmText)) score += 0.10;
  
  // Keyword overlap (semantic similarity)
  if (keywordOverlap && keywordOverlap >= 2) score += 0.15;
  else if (keywordOverlap && keywordOverlap >= 1) score += 0.05;
  
  // Actor mention
  if (actorMentioned) score += 0.10;

  // Proximity (tighter = more confident)
  if (consequenceLineIndex !== null) {
    const proximity = consequenceLineIndex - intentLineIndex;
    if (proximity >= 0 && proximity <= 5) score += 0.10;
    else if (proximity > 5 && proximity <= 10) score += 0.05;
  }

  return Math.min(0.95, score);
}

function buildLoop(params: {
  sessionId: string;
  actor: PcActor;
  chunk: RegimeChunk;
  intent: ActiveIntent;
  consequence?: {
    lineIndex: number;
    text: string;
    detection: ConsequenceDetection;
    actorMentioned: boolean;
  } | null;
}): CausalLoop {
  const consequenceType = params.consequence?.detection.consequence_type ?? "none";
  const rollType = (params.consequence?.detection.roll_type ?? null) as RollType;
  const rollSubtype = params.consequence?.detection.roll_subtype ?? null;
  const consequenceLineIndex = params.consequence?.lineIndex ?? null;
  const outcomeText = params.consequence?.text ?? "";

  const confidence = computeConfidence(
    params.intent.intent,
    params.intent.intentLineIndex,
    params.consequence?.detection ?? null,
    consequenceLineIndex,
    params.consequence?.actorMentioned ?? false,
    undefined,
    params.consequence?.text
  );

  return {
    id: randomUUID(),
    session_id: params.sessionId,
    chunk_id: params.chunk.chunk_id,
    chunk_index: params.chunk.chunk_index,
    actor: params.actor.id,
    start_index: params.intent.intentLineIndex,
    end_index: consequenceLineIndex ?? params.intent.intentLineIndex,
    intent_text: params.intent.intentText,
    intent_type: params.intent.intent.intent_type as IntentType,
    consequence_type: consequenceType,
    roll_type: rollType,
    roll_subtype: rollSubtype,
    outcome_text: outcomeText,
    confidence,
    intent_anchor_index: params.intent.intentLineIndex,
    consequence_anchor_index: consequenceLineIndex,
    created_at_ms: Date.now(),
  };
}

export function extractCausalLoopsFromChunks(
  sessionId: string,
  chunks: RegimeChunk[],
  transcript: TranscriptEntry[],
  masks: RegimeMasks,
  actors: PcActor[],
  opts: LoopExtractionOptions = {}
): CausalLoop[] {
  const attachmentWindow = opts.attachmentWindow ?? DEFAULT_ATTACHMENT_WINDOW;
  const lateBindWindow = opts.lateBindWindow ?? DEFAULT_LATE_BIND_WINDOW;
  const maxIntentGap = opts.maxIntentGap ?? DEFAULT_MAX_INTENT_GAP;
  const excludeOocSoft = opts.excludeOocSoft ?? true;

  const uniqueSpeakers = Array.from(new Set(transcript.map((l) => l.author_name)));
  const detectedDm = detectDmSpeaker(uniqueSpeakers);
  const dmNames = buildDmNameSet(detectedDm);

  const loops: CausalLoop[] = [];
  const loopByKey = new Map<string, CausalLoop>();
  const lastResolvedByActor = new Map<string, number>();

  const actorById = new Map(actors.map((a) => [a.id, a]));

  const loopIntentMeta = new Map<string, { intent: IntentDetection; intentLineIndex: number }>();

  function emitLoop(loop: CausalLoop, meta: { intent: IntentDetection; intentLineIndex: number }) {
    const key = loopKey(loop.chunk_id, loop.actor, loop.intent_anchor_index ?? loop.start_index);
    const existing = loopByKey.get(key);
    if (!existing) {
      loops.push(loop);
      loopByKey.set(key, loop);
    } else {
      const incomingHasConsequence = loop.consequence_anchor_index !== null;
      const existingHasConsequence = existing.consequence_anchor_index !== null;

      if (!existingHasConsequence && incomingHasConsequence) {
        Object.assign(existing, loop);
      } else if (existingHasConsequence && incomingHasConsequence) {
        if ((loop.confidence ?? 0) > (existing.confidence ?? 0)) {
          Object.assign(existing, loop);
        }
      }
    }
    loopIntentMeta.set(key, meta);
  }

  for (const chunk of chunks) {
    const activeIntents = new Map<string, ActiveIntent>();
    const dmConsequences: DmConsequence[] = [];

    for (let i = chunk.start_index; i <= chunk.end_index; i++) {
      const entry = transcript[i];
      if (!entry) continue;

      if (isLineMasked(entry.line_index, masks, excludeOocSoft)) {
        continue;
      }

      const isDm = isDmSpeaker(entry.author_name, dmNames);

      if (isDm) {
        const consequence = detectConsequence(entry.content);
        if (consequence.isConsequence) {
          dmConsequences.push({
            lineIndex: entry.line_index,
            text: entry.content,
            detection: consequence,
            isDirect: isDirectDmResponse(entry.content),
            keywords: tokenizeKeywords(entry.content),
          });

          let bestIntent: ActiveIntent | null = null;
          let bestScore = Number.NEGATIVE_INFINITY;
          let lastPcSpeakerId: string | null = null;
          let mostRecentIntent: ActiveIntent | null = null;
          const mentionedActors = getMentionedActors(entry.content, actors);

          for (let j = i - 1; j >= chunk.start_index; j--) {
            const prevEntry = transcript[j];
            if (!prevEntry) continue;
            if (isLineMasked(prevEntry.line_index, masks, excludeOocSoft)) continue;
            if (!isDmSpeaker(prevEntry.author_name, dmNames)) {
              const pc = matchPcSpeaker(prevEntry.author_name, actors);
              if (pc) {
                lastPcSpeakerId = pc.id;
                break;
              }
            }
          }

          for (const intent of activeIntents.values()) {
            const distance = entry.line_index - intent.intentLineIndex;
            if (distance < 0 || distance > attachmentWindow) continue;

            if (!mostRecentIntent || intent.intentLineIndex > mostRecentIntent.intentLineIndex) {
              mostRecentIntent = intent;
            }

            let score = 0;
            const actorMentioned = mentionsActor(entry.content, intent.actor);
            if (actorMentioned) score += 3;
            score += 2;
            if (lastPcSpeakerId && lastPcSpeakerId === intent.actor.id) score += 1;

            if (isDirectDmResponse(entry.content)) score += 1;

            if (
              mentionedActors.length > 0 &&
              !mentionedActors.some((a) => a.id === intent.actor.id)
            ) {
              score -= 2;
            }

            const lastResolved = lastResolvedByActor.get(intent.actor.id);
            if (typeof lastResolved === "number") {
              if (entry.line_index - lastResolved <= Math.floor(attachmentWindow / 2)) {
                score -= 2;
              }
            }

            if (score > bestScore) {
              bestScore = score;
              bestIntent = intent;
            }
          }

          if (bestIntent) {
            const actorMentioned = mentionsActor(entry.content, bestIntent.actor);
            const loop = buildLoop({
              sessionId,
              actor: bestIntent.actor,
              chunk,
              intent: bestIntent,
              consequence: {
                lineIndex: entry.line_index,
                text: entry.content,
                detection: consequence,
                actorMentioned,
              },
            });
            emitLoop(loop, {
              intent: bestIntent.intent,
              intentLineIndex: bestIntent.intentLineIndex,
            });
            activeIntents.delete(bestIntent.actor.id);
            lastResolvedByActor.set(bestIntent.actor.id, entry.line_index);
          } else if (isDirectDmResponse(entry.content) && mostRecentIntent) {
            const otherMentions = mentionedActors.filter(
              (a) => a.id !== mostRecentIntent!.actor.id
            );
            if (otherMentions.length === 0) {
              const actorMentioned = mentionsActor(entry.content, mostRecentIntent.actor);
              const loop = buildLoop({
                sessionId,
                actor: mostRecentIntent.actor,
                chunk,
                intent: mostRecentIntent,
                consequence: {
                  lineIndex: entry.line_index,
                  text: entry.content,
                  detection: consequence,
                  actorMentioned,
                },
              });
              emitLoop(loop, {
                intent: mostRecentIntent.intent,
                intentLineIndex: mostRecentIntent.intentLineIndex,
              });
              activeIntents.delete(mostRecentIntent.actor.id);
              lastResolvedByActor.set(mostRecentIntent.actor.id, entry.line_index);
            }
          }
        }
      } else {
        const actor = matchPcSpeaker(entry.author_name, actors);
        if (actor) {
          const intent = detectIntent(entry.content);
          if (intent.isIntent && intent.strongIntent) {
            const existing = activeIntents.get(actor.id);
            if (existing) {
              const distance = entry.line_index - existing.intentLineIndex;
              
              // Merge if: same questions OR similar action verbs within 6 lines
              const shouldMerge = distance <= 6 && (
                (isQuestionLikeIntent(existing.intentText) && isQuestionLikeIntent(entry.content)) ||
                sharesSimilarAction(existing.intentText, entry.content)
              );
              
              if (shouldMerge) {
                existing.intentText = `${existing.intentText} / ${entry.content}`;
                continue;
              }

              const loop = buildLoop({
                sessionId,
                actor,
                chunk,
                intent: existing,
                consequence: null,
              });
              emitLoop(loop, {
                intent: existing.intent,
                intentLineIndex: existing.intentLineIndex,
              });
            }

            activeIntents.set(actor.id, {
              actor,
              intent,
              intentLineIndex: entry.line_index,
              intentText: entry.content,
            });
          }
        }
      }

      for (const [actorId, intent] of Array.from(activeIntents.entries())) {
        if (entry.line_index - intent.intentLineIndex > maxIntentGap) {
          const loop = buildLoop({
            sessionId,
            actor: intent.actor,
            chunk,
            intent,
            consequence: null,
          });
          emitLoop(loop, {
            intent: intent.intent,
            intentLineIndex: intent.intentLineIndex,
          });
          activeIntents.delete(actorId);
        }
      }
    }

    for (const intent of activeIntents.values()) {
      const loop = buildLoop({
        sessionId,
        actor: intent.actor,
        chunk,
        intent,
        consequence: null,
      });
      emitLoop(loop, {
        intent: intent.intent,
        intentLineIndex: intent.intentLineIndex,
      });
    }

    const unresolved = Array.from(loopByKey.values()).filter(
      (loop) =>
        loop.consequence_anchor_index === null &&
        loop.start_index >= chunk.start_index &&
        loop.end_index <= chunk.end_index
    );

    const usedConsequences = new Set<number>();

    for (const consequence of dmConsequences) {
      let bestLoop: CausalLoop | null = null;
      let bestScore = Number.NEGATIVE_INFINITY;
      let bestOverlap = 0;
      let bestActorMentioned = false;

      for (const loop of unresolved) {
        const meta = loopIntentMeta.get(loopKey(loop.chunk_id, loop.actor, loop.intent_anchor_index));
        if (!meta) continue;

        if (consequence.lineIndex <= meta.intentLineIndex) continue;
        if (consequence.lineIndex > meta.intentLineIndex + lateBindWindow) continue;

        const actorObj = actorById.get(loop.actor);
        if (!actorObj) continue;

        const actorMentioned = mentionsActor(consequence.text, actorObj);
        const overlap = countOverlap(tokenizeKeywords(loop.intent_text ?? ""), consequence.keywords);
        const distance = consequence.lineIndex - meta.intentLineIndex;

        const compatible =
          consequence.isDirect ||
          overlap >= 1 ||
          consequence.detection.consequence_type === "roll";

        if (!compatible) continue;

        let score = 0;
        if (actorMentioned) score += 3;
        if (consequence.detection.consequence_type === "roll") score += 2;
        if (consequence.isDirect) score += 1;
        score += Math.min(3, overlap);
        score += Math.max(0, 3 - distance * 0.1);

        const lastResolved = lastResolvedByActor.get(loop.actor);
        if (typeof lastResolved === "number" && consequence.lineIndex - lastResolved <= 6) {
          score -= 2;
        }

        if (score > bestScore) {
          bestScore = score;
          bestLoop = loop;
          bestOverlap = overlap;
          bestActorMentioned = actorMentioned;
        }
      }

      if (bestLoop && !usedConsequences.has(consequence.lineIndex)) {
        const meta = loopIntentMeta.get(loopKey(bestLoop.chunk_id, bestLoop.actor, bestLoop.intent_anchor_index));
        if (meta) {
          applyConsequenceToLoop(
            bestLoop,
            meta.intent,
            meta.intentLineIndex,
            consequence,
            bestActorMentioned,
            bestOverlap
          );
          usedConsequences.add(consequence.lineIndex);
        }
      }
    }
  }

  // Filter loops: keep resolved OR high-value unresolved
  const filteredLoops = loops.filter((loop) => {
    if (loop.consequence_anchor_index !== null) return true;
    return isHighValueIntent(loop.intent_text ?? "");
  });

  return filteredLoops;
}
