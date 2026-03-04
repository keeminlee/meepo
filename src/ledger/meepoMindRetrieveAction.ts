import { getDbForCampaign } from "../db.js";
import type { MeepoMindRetrievePayload } from "./meepoContextRepo.js";
import {
  buildRetrievalArtifactPath,
  type MeepoMindRetrievalArtifact,
  type RetrievalMemory,
  writeRetrievalArtifact,
} from "./meepoMindRetrievalArtifacts.js";
import { DIEGETIC_LEGACY_MINDSPACE } from "./meepo-mind.js";

type MindRow = {
  id: string;
  title: string;
  content: string;
  gravity: number;
  certainty: number;
  created_at_ms: number;
};

function toRetrievalMemory(row: MindRow, score: number): RetrievalMemory {
  return {
    memory_id: row.id,
    title: row.title,
    text: row.content,
    score,
    tags: [],
    source: "meepomind_db",
  };
}

export function executeMeepoMindRetrieveAction(payload: MeepoMindRetrievePayload): {
  artifactPath: string;
  alwaysCount: number;
  rankedCount: number;
  dbMs: number;
} {
  const db = getDbForCampaign(payload.campaign_slug);
  const mindspace = `campaign:${payload.guild_id}:${payload.session_id}`;
  const started = Date.now();

  const alwaysRows = db
    .prepare(
      `SELECT id, title, content, gravity, certainty, created_at_ms
       FROM meepo_mind
       WHERE mindspace IN (?, ?)
         AND gravity = 1.0
         AND certainty = 1.0
       ORDER BY id ASC`
    )
    .all(mindspace, DIEGETIC_LEGACY_MINDSPACE) as MindRow[];

  const rankedRows = db
    .prepare(
      `SELECT id, title, content, gravity, certainty, created_at_ms
       FROM meepo_mind
       WHERE mindspace IN (?, ?)
       ORDER BY gravity DESC, certainty DESC, id ASC
       LIMIT ?`
    )
    .all(mindspace, DIEGETIC_LEGACY_MINDSPACE, payload.top_k) as MindRow[];

  const alwaysMemories = alwaysRows.map((row) => toRetrievalMemory(row, 1.0));
  const alwaysIds = new Set(alwaysMemories.map((memory) => memory.memory_id));

  const rankedMemories = rankedRows
    .filter((row) => !alwaysIds.has(row.id))
    .map((row) => toRetrievalMemory(row, Number((row.gravity * row.certainty).toFixed(6))));

  const dbMs = Date.now() - started;

  const artifactPath = buildRetrievalArtifactPath({
    campaignSlug: payload.campaign_slug,
    sessionId: payload.session_id,
    anchorLedgerId: payload.anchor_ledger_id,
    algoVersion: payload.algo_version,
    topK: payload.top_k,
    queryHash: payload.query_hash,
  });

  const artifact: MeepoMindRetrievalArtifact = {
    schema_version: 1,
    kind: "meepo_mind_retrieval",
    campaign_slug: payload.campaign_slug,
    session_id: payload.session_id,
    anchor_ledger_id: payload.anchor_ledger_id,
    created_at_ms: Date.now(),
    algo_version: payload.algo_version,
    query_hash: payload.query_hash,
    top_k: payload.top_k,
    always: {
      criteria: {
        gravity: 1.0,
        certainty: 1.0,
        resilience: 1.0,
      },
      memories: alwaysMemories,
    },
    ranked: {
      memories: rankedMemories,
    },
    stats: {
      always_count: alwaysMemories.length,
      ranked_count: rankedMemories.length,
      db_ms: dbMs,
    },
  };

  writeRetrievalArtifact({ artifactPath, artifact });

  return {
    artifactPath,
    alwaysCount: artifact.stats.always_count,
    rankedCount: artifact.stats.ranked_count,
    dbMs,
  };
}
