import type { TranscriptEntry } from "../ledger/transcripts.js";
import type { RegimeChunk, RegimeMasks } from "./pruneRegimes.js";
import { detectIntent } from "./detectIntent.js";
import { detectConsequence } from "./detectConsequence.js";
import type { IntentNode, ConsequenceNode } from "./intentGraphTypes.js";
import { makeConsequenceId, makeIntentId } from "./intentGraphTypes.js";
import type { ActorLike } from "./actorFeatures.js";
import { buildActorNameSet } from "./actorFeatures.js";
import { normalizeName } from "./textFeatures.js";
import type { YesNoBundle } from "./bundleYesNo.js";

function isLineMasked(lineIndex: number, masks: RegimeMasks, includeOocSoft: boolean): boolean {
  for (const span of masks.oocHard) {
    if (lineIndex >= span.start_index && lineIndex <= span.end_index) return true;
  }
  if (!includeOocSoft) {
    for (const span of masks.oocSoft) {
      if (lineIndex >= span.start_index && lineIndex <= span.end_index) return true;
    }
  }
  for (const span of masks.combat) {
    if (lineIndex >= span.start_index && lineIndex <= span.end_index) return true;
  }
  return false;
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

function findOwnerChunk(chunks: RegimeChunk[], anchorIndex: number): RegimeChunk | null {
  for (const chunk of chunks) {
    if (anchorIndex >= chunk.start_index && anchorIndex <= chunk.end_index) {
      return chunk;
    }
  }
  return null;
}

export function extractIntentConsequenceNodes(params: {
  sessionId: string;
  transcript: TranscriptEntry[];
  chunks: RegimeChunk[];
  masks: RegimeMasks;
  includeOocSoft: boolean;
  actors: ActorLike[];
  isDmSpeaker: (speaker: string) => boolean;
  bundles: YesNoBundle[];
  consumedLineIndices: Set<number>;
  buffer: number;
}): {
  intents: IntentNode[];
  consequences: ConsequenceNode[];
} {
  const intentsById = new Map<string, IntentNode>();
  const consequencesById = new Map<string, ConsequenceNode>();

  for (const bundle of params.bundles) {
    const ownerChunk = findOwnerChunk(params.chunks, bundle.answer_index);
    if (!ownerChunk) continue;

    const intentId = makeIntentId(params.sessionId, bundle.actor_id, bundle.answer_index);
    intentsById.set(intentId, {
      intent_id: intentId,
      session_id: params.sessionId,
      chunk_id: ownerChunk.chunk_id,
      actor_id: bundle.actor_id,
      anchor_index: bundle.answer_index,
      intent_type: "request",
      text: bundle.text,
      source: "bundle_yesno",
      buffer_intent: false,
      is_strong_intent: true,
    });
  }

  for (const owner of params.chunks) {
    const windowStart = Math.max(0, owner.start_index - params.buffer);
    const windowEnd = Math.min(params.transcript.length - 1, owner.end_index + params.buffer);

    for (let i = windowStart; i <= windowEnd; i++) {
      const line = params.transcript[i];
      if (!line) continue;
      if (params.consumedLineIndices.has(line.line_index)) continue;
      if (isLineMasked(line.line_index, params.masks, params.includeOocSoft)) continue;

      const lineOwner = findOwnerChunk(params.chunks, line.line_index);
      if (!lineOwner) continue;
      if (lineOwner.chunk_id !== owner.chunk_id) continue;

      if (params.isDmSpeaker(line.author_name)) {
        const consequence = detectConsequence(line.content);
        if (!consequence.isConsequence) continue;

        const consequenceId = makeConsequenceId(params.sessionId, line.line_index);
        const ctype =
          consequence.consequence_type === "none"
            ? "other"
            : consequence.consequence_type;

        consequencesById.set(consequenceId, {
          consequence_id: consequenceId,
          session_id: params.sessionId,
          chunk_id: owner.chunk_id,
          anchor_index: line.line_index,
          consequence_type: ctype,
          roll_type: consequence.roll_type ?? null,
          roll_subtype: consequence.roll_subtype ?? null,
          text: line.content,
          buffer_cons: line.line_index < owner.start_index || line.line_index > owner.end_index,
        });
        continue;
      }

      const actor = matchPcSpeaker(line.author_name, params.actors);
      if (!actor) continue;

      const intent = detectIntent(line.content);
      if (!intent.isIntent) continue;

      const intentId = makeIntentId(params.sessionId, actor.id, line.line_index);
      intentsById.set(intentId, {
        intent_id: intentId,
        session_id: params.sessionId,
        chunk_id: owner.chunk_id,
        actor_id: actor.id,
        anchor_index: line.line_index,
        intent_type: intent.intent_type,
        text: line.content,
        source: "pc_line",
        buffer_intent: line.line_index < owner.start_index || line.line_index > owner.end_index,
        is_strong_intent: intent.strongIntent,
      });
    }
  }

  // Second pass: Add DM statements within 5 lines of any intent as dm_statement consequences
  const intentLineIndices = Array.from(intentsById.values()).map((intent) => intent.anchor_index);
  const consequenceLineIndices = new Set(Array.from(consequencesById.values()).map((c) => c.anchor_index));
  const DM_PROXIMITY_WINDOW = 5;

  for (const owner of params.chunks) {
    const windowStart = Math.max(0, owner.start_index - params.buffer);
    const windowEnd = Math.min(params.transcript.length - 1, owner.end_index + params.buffer);

    for (let i = windowStart; i <= windowEnd; i++) {
      const line = params.transcript[i];
      if (!line) continue;
      if (params.consumedLineIndices.has(line.line_index)) continue;
      if (isLineMasked(line.line_index, params.masks, params.includeOocSoft)) continue;

      const lineOwner = findOwnerChunk(params.chunks, line.line_index);
      if (!lineOwner) continue;
      if (lineOwner.chunk_id !== owner.chunk_id) continue;

      if (!params.isDmSpeaker(line.author_name)) continue;

      // Skip if already a pattern-matched consequence
      if (consequenceLineIndices.has(line.line_index)) continue;

      // Check if within 5 lines of any intent
      const isNearIntent = intentLineIndices.some(
        (intentIdx) => Math.abs(line.line_index - intentIdx) <= DM_PROXIMITY_WINDOW
      );

      if (!isNearIntent) continue;

      const consequenceId = makeConsequenceId(params.sessionId, line.line_index);
      consequencesById.set(consequenceId, {
        consequence_id: consequenceId,
        session_id: params.sessionId,
        chunk_id: owner.chunk_id,
        anchor_index: line.line_index,
        consequence_type: "dm_statement",
        roll_type: null,
        roll_subtype: null,
        text: line.content,
        buffer_cons: line.line_index < owner.start_index || line.line_index > owner.end_index,
      });
    }
  }

  return {
    intents: Array.from(intentsById.values()).sort((a, b) => a.anchor_index - b.anchor_index),
    consequences: Array.from(consequencesById.values()).sort(
      (a, b) => a.anchor_index - b.anchor_index
    ),
  };
}
