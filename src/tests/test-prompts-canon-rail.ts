import { afterEach, describe, expect, test, vi } from "vitest";

let personaScope: "campaign" | "meta" = "campaign";

vi.mock("../utils/logger.js", () => ({
  log: {
    withScope: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  },
}));

vi.mock("../personas/index.js", () => ({
  getPersona: vi.fn(() => ({
    displayName: "Test Persona",
    scope: personaScope,
    systemGuardrails: "guardrails",
    identity: "identity",
    memory: "",
    speechStyle: "speech",
    personalityTone: "tone",
    styleGuard: "style",
  })),
}));

vi.mock("../ledger/meepo-mind.js", () => ({
  getMeepoMemoriesSection: vi.fn(async () => ({ section: "", memoryRefs: [] })),
}));

vi.mock("../ledger/meepoInteractions.js", () => ({
  findRelevantMeepoInteractions: vi.fn(() => ({ S: [], A: [] })),
  formatMeepoInteractionsSection: vi.fn(() => ""),
}));

vi.mock("../campaign/guildConfig.js", () => ({
  resolveCampaignSlug: vi.fn(() => "default"),
}));

vi.mock("../db.js", () => ({
  getDbForCampaign: vi.fn(() => ({ prepare: vi.fn() })),
}));

vi.mock("../gold/goldMemoryRepo.js", () => ({
  getGoldMemoriesForQuery: vi.fn(() => []),
}));

vi.mock("../config/env.js", () => ({
  cfg: {
    logging: {
      level: "warn",
      scopes: [],
      format: "pretty",
    },
    features: {
      goldMemoryEnabled: false,
    },
  },
}));

afterEach(() => {
  personaScope = "campaign";
  vi.clearAllMocks();
  vi.resetModules();
});

describe("buildMeepoPrompt canon rail", () => {
  test("includes canon rail for campaign personas", async () => {
    personaScope = "campaign";
    const { buildMeepoPrompt } = await import("../llm/prompts.js");

    const result = await buildMeepoPrompt({
      personaId: "diegetic_meepo",
      mindspace: null,
      meepo: { persona_seed: null } as any,
      recentContext: "DM: The door opens.",
      guildId: "guild-1",
    });

    expect(result.systemPrompt).toContain("Canon rail: The DM's narration is world truth.");
    expect(result.systemPrompt).toContain("Do not address the DM/NPCs directly.");
  });

  test("does not include canon rail for non-campaign personas", async () => {
    personaScope = "meta";
    const { buildMeepoPrompt } = await import("../llm/prompts.js");

    const result = await buildMeepoPrompt({
      personaId: "meta_meepo",
      mindspace: null,
      meepo: { persona_seed: null } as any,
      recentContext: "Player: hello",
      guildId: "guild-1",
    });

    expect(result.systemPrompt).not.toContain("Canon rail: The DM's narration is world truth.");
  });
});
