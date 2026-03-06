import { afterEach, describe, expect, test, vi } from "vitest";

const enqueueSpy = vi.fn();

vi.mock("../db.js", () => ({
  getDbForCampaign: vi.fn(() => ({ prepare: vi.fn(() => ({ get: vi.fn() })) })),
}));

vi.mock("../ledger/meepoContextActions.js", () => ({
  enqueueMeepoMindRetrieveIfNeeded: enqueueSpy,
}));

vi.mock("../ledger/meepoActionLogging.js", () => ({
  appendMeepoActionLogEvent: vi.fn(),
}));

vi.mock("../ledger/meepoMindRetrievalArtifacts.js", () => ({
  computeRetrievalQueryHash: vi.fn(() => "hash1234abcd"),
  buildRetrievalArtifactPath: vi.fn(() => "retrieval.json"),
  loadRetrievalArtifact: vi.fn(() => ({
    schema_version: 1,
    kind: "meepo_mind_retrieval",
    campaign_slug: "default",
    session_id: "session-1",
    anchor_ledger_id: "48392",
    created_at_ms: 0,
    algo_version: "v1.2.1",
    query_hash: "hash1234abcd",
    top_k: 8,
    always: {
      criteria: { gravity: 1.0, certainty: 1.0, resilience: 1.0 },
      memories: [{ memory_id: "a", title: "Core", text: "Always", score: 1, tags: [], source: "meepomind_db" }],
    },
    ranked: {
      memories: [{ memory_id: "b", title: "Ranked", text: "Relevant", score: 0.5, tags: [], source: "meepomind_db" }],
    },
    stats: {
      always_count: 1,
      ranked_count: 1,
      db_ms: 2,
    },
  })),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("prompt bundle retrieval include", () => {
  test("includes retrieval context when artifact exists", async () => {
    const { buildMeepoPromptBundle } = await import("../llm/buildMeepoPromptBundle.js");

    const bundle = buildMeepoPromptBundle({
      guild_id: "guild-1",
      campaign_slug: "default",
      session_id: "session-1",
      anchor_ledger_id: "48392",
      user_text: "hello world",
      meepo_context_snapshot: { context: "ctx" },
      persona: {
        id: "diegetic_meepo",
        displayName: "Meepo",
        scope: "campaign",
        systemGuardrails: "guard",
        identity: "identity",
        speechStyle: "style",
        personalityTone: "tone",
        styleGuard: "sg",
        styleSpec: {
          name: "Meepo",
          voice: "gentle",
          punctuation: "low",
          caps: "never",
        },
      },
    });

    expect(bundle.retrieval?.core_memories).toHaveLength(1);
    expect(bundle.retrieval?.relevant_memories).toHaveLength(1);
    expect(enqueueSpy).not.toHaveBeenCalled();
  });
});
