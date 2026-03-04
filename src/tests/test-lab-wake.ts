import { describe, expect, test, vi, afterEach } from "vitest";
import type { Session } from "../sessions/sessions.js";

vi.mock("../config/env.js", () => ({
  cfg: {
    logging: { level: "warn", scopes: [], format: "pretty" },
    voice: { debug: false },
    data: { root: ".", campaignsDir: "campaigns" },
    features: { labCommandsEnabled: true },
    access: { devUserIds: [], devGuildIds: [] },
  },
}));

vi.mock("../db.js", () => ({
  getDbForCampaign: vi.fn(() => ({ prepare: vi.fn(() => ({ get: vi.fn(() => null) })) })),
}));

vi.mock("../campaign/guildConfig.js", () => ({
  resolveCampaignSlug: vi.fn(() => "default"),
}));

const stubLegacyCommand = {
  data: {
    toJSON: () => ({
      name: "stub",
      description: "stub",
      options: [{ type: 1, name: "run", description: "run", options: [] }],
    }),
  },
  execute: vi.fn(async () => {}),
};

vi.mock("../commands/meepoLegacy.js", () => ({ meepo: stubLegacyCommand }));
vi.mock("../commands/session.js", () => ({ session: stubLegacyCommand }));
vi.mock("../commands/meeps.js", () => ({ meeps: stubLegacyCommand }));
vi.mock("../commands/missions.js", () => ({ missions: stubLegacyCommand }));
vi.mock("../commands/goldmem.js", () => ({ goldmem: stubLegacyCommand }));

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

function buildSession(overrides?: Partial<Session>): Session {
  return {
    session_id: "s1",
    guild_id: "g1",
    kind: "canon",
    mode_at_start: "canon",
    label: "Arena Night",
    created_at_ms: 1_000,
    started_at_ms: 1_000,
    ended_at_ms: null,
    ended_reason: null,
    started_by_id: "u1",
    started_by_name: "User",
    source: "live",
    ...overrides,
  } as Session;
}

describe("lab wake resolver", () => {
  test("active official canon exists: reuses and does not start", async () => {
    const { resolveOrStartLabSession } = await import("../commands/lab.js");
    const active = buildSession({
      session_id: "official-1",
      kind: "canon",
      mode_at_start: "canon",
      label: "C2E21",
    });

    let startCalls = 0;
    const result = resolveOrStartLabSession(
      {
        guildId: "g1",
        requestedKind: "noncanon",
        label: "ignored",
      },
      {
        getActiveSessionFn: () => active,
        startSessionFn: () => {
          startCalls += 1;
          return buildSession();
        },
        labelExistsFn: () => false,
        nowMsFn: () => Date.UTC(2026, 2, 4, 12, 30, 45),
      }
    );

    expect(result.action).toBe("reused-official");
    expect(result.noLabCreated).toBe(true);
    expect(result.session.session_id).toBe("official-1");
    expect(startCalls).toBe(0);
  });

  test("active lab-created session exists: reuses existing", async () => {
    const { resolveOrStartLabSession } = await import("../commands/lab.js");
    const active = buildSession({
      session_id: "lab-1",
      kind: "noncanon",
      mode_at_start: "lab",
      label: "retrieval-test",
    });

    let startCalls = 0;
    const result = resolveOrStartLabSession(
      {
        guildId: "g1",
        requestedKind: "canon",
      },
      {
        getActiveSessionFn: () => active,
        startSessionFn: () => {
          startCalls += 1;
          return buildSession();
        },
        labelExistsFn: () => false,
        nowMsFn: () => Date.UTC(2026, 2, 4, 12, 30, 45),
      }
    );

    expect(result.action).toBe("reused-existing");
    expect(result.noLabCreated).toBe(true);
    expect(result.session.session_id).toBe("lab-1");
    expect(startCalls).toBe(0);
  });

  test("no active session: creates new default canon lab session with UTC auto label", async () => {
    const { resolveOrStartLabSession } = await import("../commands/lab.js");
    let capturedOpts: any = null;
    const started = buildSession({
      session_id: "new-1",
      kind: "canon",
      mode_at_start: "lab",
      label: "lab_20260304_123045_01",
    });

    const result = resolveOrStartLabSession(
      {
        guildId: "g1",
      },
      {
        getActiveSessionFn: () => null,
        startSessionFn: (_guildId, _byId, _byName, opts) => {
          capturedOpts = opts;
          return started;
        },
        labelExistsFn: (_guildId, label) => label === "lab_20260304_123045",
        nowMsFn: () => Date.UTC(2026, 2, 4, 12, 30, 45),
      }
    );

    expect(result.action).toBe("started-new");
    expect(result.created).toBe(true);
    expect(capturedOpts).toMatchObject({
      kind: "canon",
      modeAtStart: "lab",
      label: "lab_20260304_123045_01",
    });
  });

  test("no active session with explicit kind+label: passes exact values", async () => {
    const { resolveOrStartLabSession } = await import("../commands/lab.js");
    let capturedOpts: any = null;
    const started = buildSession({
      session_id: "new-2",
      kind: "noncanon",
      mode_at_start: "lab",
      label: "test_canon",
    });

    const result = resolveOrStartLabSession(
      {
        guildId: "g1",
        requestedKind: "noncanon",
        label: "test_canon",
      },
      {
        getActiveSessionFn: () => null,
        startSessionFn: (_guildId, _byId, _byName, opts) => {
          capturedOpts = opts;
          return started;
        },
        labelExistsFn: () => false,
        nowMsFn: () => Date.UTC(2026, 2, 4, 12, 30, 45),
      }
    );

    expect(result.action).toBe("started-new");
    expect(capturedOpts).toMatchObject({
      kind: "noncanon",
      modeAtStart: "lab",
      label: "test_canon",
    });
  });
});
