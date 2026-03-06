import { createHash } from "node:crypto";
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
  computeRetrievalQueryHash: (queryText?: string) =>
    createHash("sha256").update((queryText ?? "").trim().toLowerCase(), "utf8").digest("hex"),
  buildRetrievalArtifactPath: vi.fn(() => "retrieval.json"),
  loadRetrievalArtifact: vi.fn(() => null),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("prompt bundle retrieval fallback", () => {
  test("returns without retrieval and enqueues retrieval action", async () => {
    const { buildMeepoPromptBundle } = await import("../llm/buildMeepoPromptBundle.js");

    const userText = "   HeLLo Meepo   ";
    const bundle = buildMeepoPromptBundle({
      guild_id: "guild-1",
      campaign_slug: "default",
      session_id: "session-1",
      anchor_ledger_id: "48392",
      user_text: userText,
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

    const expectedHash = createHash("sha256")
      .update("hello meepo", "utf8")
      .digest("hex");

    expect(bundle.retrieval).toBeUndefined();
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy.mock.calls[0]?.[1]?.queryHash).toBe(expectedHash);
  });
});
