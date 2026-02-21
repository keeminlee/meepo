import type { CandidateEdge, ConsequenceNode, GraphParams, IntentNode } from "./intentGraphTypes.js";
import { makeEdgeId } from "./intentGraphTypes.js";
import { distanceScoreHill, hasAnswerForm, lexicalScore01, tokenizeKeywords } from "./textFeatures.js";
import type { ActorLike } from "./actorFeatures.js";
import { mentionsActor } from "./actorFeatures.js";

function sumIdf(tokens: string[], idf: Map<string, number>): number {
  let score = 0;
  for (const token of tokens) {
    score += idf.get(token) ?? 1;
  }
  return score;
}

export function scoreEdgesForward(params: {
  sessionId: string;
  intents: IntentNode[];
  consequences: ConsequenceNode[];
  idf: Map<string, number>;
  actorsById: Map<string, ActorLike>;
  graphParams: GraphParams;
}): CandidateEdge[] {
  const out: CandidateEdge[] = [];

  for (const consequence of params.consequences) {
    const candidates: CandidateEdge[] = [];

    for (const intent of params.intents) {
      const distance = consequence.anchor_index - intent.anchor_index;
      if (distance < 0 || distance > params.graphParams.maxBack) continue;

      // Hill distance curve (replaces exponential)
      const distanceScore = distanceScoreHill(
        distance,
        params.graphParams.distTau,
        params.graphParams.distP
      );

      const intentTokens = tokenizeKeywords(intent.text);
      const consequenceTokens = tokenizeKeywords(consequence.text);
      const sharedTerms = Array.from(intentTokens).filter((token) => consequenceTokens.has(token));
      
      // Raw lexical score (sum of IDF)
      const lexicalScoreRaw = sumIdf(sharedTerms, params.idf);
      
      // Normalized lexical score [0, 1)
      const lexicalScoreNorm = lexicalScore01(lexicalScoreRaw, params.graphParams.lexK);

      const flags: CandidateEdge["flags"] = {
        answer_form: hasAnswerForm(consequence.text),
        roll_request: consequence.consequence_type === "roll",
        bundle_yesno: intent.source === "bundle_yesno",
        buffer_intent: intent.buffer_intent,
        buffer_cons: consequence.buffer_cons,
        question_to_answer: intent.intent_type === "question" && hasAnswerForm(consequence.text),
      };

      let heuristicBoost = 1;
      if (flags.answer_form) heuristicBoost *= 1.15;
      if (flags.roll_request) heuristicBoost *= 1.2;
      if (flags.bundle_yesno) heuristicBoost *= 1.1;
      if (flags.question_to_answer) heuristicBoost *= 1.1;

      const actor = params.actorsById.get(intent.actor_id);
      if (actor && mentionsActor(consequence.text, actor)) {
        flags.mentions_actor = true;
        heuristicBoost *= 1.1;
      }

      // Distance-first multiplicative combination
      const baseScore =
        distanceScore * (1 + params.graphParams.betaLex * lexicalScoreNorm) * heuristicBoost;

      candidates.push({
        edge_id: makeEdgeId(intent.intent_id, consequence.consequence_id),
        session_id: params.sessionId,
        chunk_id: consequence.chunk_id,
        intent_id: intent.intent_id,
        consequence_id: consequence.consequence_id,
        distance,
        distance_score: distanceScore,
        lexical_score: lexicalScoreRaw, // store raw for debugging
        heuristic_boost: heuristicBoost,
        base_score: baseScore,
        adjusted_score: baseScore,
        shared_terms: sharedTerms.slice(0, 8),
        flags,
      });
    }

    candidates.sort((a, b) => b.base_score - a.base_score);
    out.push(...candidates.slice(0, params.graphParams.topK));
  }

  return out;
}
