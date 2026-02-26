import { getDb } from "../../db.js";
import type { CandidateEdge, ConsequenceNode, IntentNode } from "../../causal/intentGraphTypes.js";

export function persistIntentGraph(sessionId: string, payload: {
  intents: IntentNode[];
  consequences: ConsequenceNode[];
  edges: CandidateEdge[];
}): void {
  const db = getDb();

  const delEdges = db.prepare("DELETE FROM intent_consequence_edges WHERE session_id = ?");
  const delConsequences = db.prepare("DELETE FROM consequence_nodes WHERE session_id = ?");
  const delIntents = db.prepare("DELETE FROM intent_nodes WHERE session_id = ?");

  const insIntent = db.prepare(
    `INSERT INTO intent_nodes (
      intent_id, session_id, chunk_id, actor_id, anchor_index,
      intent_type, text, source, is_strong_intent, created_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const insConsequence = db.prepare(
    `INSERT INTO consequence_nodes (
      consequence_id, session_id, chunk_id, anchor_index, consequence_type,
      roll_type, roll_subtype, text, created_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const insEdge = db.prepare(
    `INSERT INTO intent_consequence_edges (
      edge_id, session_id, chunk_id, intent_id, consequence_id, distance,
      distance_score, lexical_score, heuristic_boost, base_score, adjusted_score,
      shared_terms_json, flags_json, created_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const now = Date.now();

  db.transaction(() => {
    delEdges.run(sessionId);
    delConsequences.run(sessionId);
    delIntents.run(sessionId);

    for (const intent of payload.intents) {
      insIntent.run(
        intent.intent_id,
        sessionId,
        intent.chunk_id,
        intent.actor_id,
        intent.anchor_index,
        intent.intent_type,
        intent.text,
        intent.source,
        intent.is_strong_intent ? 1 : 0,
        now
      );
    }

    for (const consequence of payload.consequences) {
      insConsequence.run(
        consequence.consequence_id,
        sessionId,
        consequence.chunk_id,
        consequence.anchor_index,
        consequence.consequence_type,
        consequence.roll_type ?? null,
        consequence.roll_subtype ?? null,
        consequence.text,
        now
      );
    }

    for (const edge of payload.edges) {
      insEdge.run(
        edge.edge_id,
        sessionId,
        edge.chunk_id,
        edge.intent_id,
        edge.consequence_id,
        edge.distance,
        edge.distance_score,
        edge.lexical_score,
        edge.heuristic_boost,
        edge.base_score,
        edge.adjusted_score,
        JSON.stringify(edge.shared_terms),
        JSON.stringify(edge.flags),
        now
      );
    }
  })();
}
