import type { TranscriptEntry } from "../ledger/transcripts.js";
import type { ActorLike } from "./actorFeatures.js";
import { buildActorNameSet } from "./actorFeatures.js";
import { isYesNoAnswerLike, normalizeName } from "./textFeatures.js";

export type YesNoBundle = {
  session_id: string;
  actor_id: string;
  prompt_index: number;
  answer_index: number;
  text: string;
};

function isYesNoPrompt(text: string): boolean {
  if (!/\?/.test(text)) return false;
  return /(are you|do you|did you|can you|could you|would you|is it|was it|did that|right\?|correct\?)/i.test(
    text
  );
}

function matchPcSpeaker<T extends ActorLike>(speaker: string, actors: T[]): T | null {
  const normSpeaker = normalizeName(speaker);
  if (!normSpeaker) return null;

  let best: T | null = null;
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

export function bundleYesNo(params: {
  sessionId: string;
  transcript: TranscriptEntry[];
  actors: ActorLike[];
  isDmSpeaker: (speaker: string) => boolean;
}): { bundles: YesNoBundle[]; consumedLineIndices: Set<number> } {
  const bundles: YesNoBundle[] = [];
  const consumed = new Set<number>();

  for (let i = 0; i < params.transcript.length; i++) {
    const dmLine = params.transcript[i];
    if (!dmLine) continue;
    if (!params.isDmSpeaker(dmLine.author_name)) continue;
    if (!isYesNoPrompt(dmLine.content)) continue;

    for (let j = i + 1; j <= Math.min(i + 2, params.transcript.length - 1); j++) {
      const reply = params.transcript[j];
      if (!reply) continue;
      if (params.isDmSpeaker(reply.author_name)) continue;

      const actor = matchPcSpeaker(reply.author_name, params.actors);
      if (!actor) continue;

      if (!isYesNoAnswerLike(reply.content)) continue;

      const normalizedReply = /^\s*yes\b/i.test(reply.content) ? "YES" : "NO";
      bundles.push({
        session_id: params.sessionId,
        actor_id: actor.id,
        prompt_index: dmLine.line_index,
        answer_index: reply.line_index,
        text: `DM prompt: ${dmLine.content} | PC answer: ${normalizedReply}`,
      });

      consumed.add(dmLine.line_index);
      consumed.add(reply.line_index);
      break;
    }
  }

  return { bundles, consumedLineIndices: consumed };
}
