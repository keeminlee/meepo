import Database from "better-sqlite3";
import { afterEach, describe, expect, test, vi } from "vitest";

let capturedArtifact: any = null;

vi.mock("../db.js", () => ({
  getDbForCampaign: vi.fn(),
}));

vi.mock("../ledger/meepo-mind.js", () => ({
  DIEGETIC_LEGACY_MINDSPACE: "campaign:global:legacy",
}));

vi.mock("../ledger/meepoMindRetrievalArtifacts.js", () => {
  return {
    buildRetrievalArtifactPath: vi.fn(() => "artifact.json"),
    writeRetrievalArtifact: vi.fn(({ artifact }: { artifact: unknown }) => {
      capturedArtifact = artifact;
    }),
  };
});

afterEach(() => {
  capturedArtifact = null;
  vi.clearAllMocks();
});

describe("always tier retrieval", () => {
  test("always tier is present regardless of top_k and includes explicit counts", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE meepo_mind (
        id TEXT PRIMARY KEY,
        mindspace TEXT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        gravity REAL NOT NULL,
        certainty REAL NOT NULL,
        created_at_ms INTEGER NOT NULL,
        last_accessed_at_ms INTEGER
      );
    `);

    db.prepare(`
      INSERT INTO meepo_mind (id, mindspace, title, content, gravity, certainty, created_at_ms, last_accessed_at_ms)
      VALUES
        ('m2', 'campaign:guild-1:session-1', 'Always B', 'two', 1.0, 1.0, 2, NULL),
        ('m1', 'campaign:guild-1:session-1', 'Always A', 'one', 1.0, 1.0, 1, NULL),
        ('m3', 'campaign:guild-1:session-1', 'Ranked', 'three', 0.8, 0.9, 3, NULL)
    `).run();

    const { getDbForCampaign } = await import("../db.js");
    vi.mocked(getDbForCampaign).mockReturnValue(db as any);

    const { executeMeepoMindRetrieveAction } = await import("../ledger/meepoMindRetrieveAction.js");
    executeMeepoMindRetrieveAction({
      guild_id: "guild-1",
      campaign_slug: "default",
      scope: "canon",
      session_id: "session-1",
      anchor_ledger_id: "48392",
      query_text: "anything",
      query_hash: "abc",
      top_k: 0,
      algo_version: "v1.2.1",
      include_always_tier: true,
    });

    expect(capturedArtifact).toBeTruthy();
    expect(capturedArtifact.always.memories.map((m: any) => m.memory_id)).toEqual(["m1", "m2"]);
    expect(capturedArtifact.stats.always_count).toBe(2);
    expect(capturedArtifact.stats.ranked_count).toBe(0);
    expect(typeof capturedArtifact.stats.db_ms).toBe("number");
  });
});
