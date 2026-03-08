import type { CampaignSummary, SessionDetail, SessionSummary } from "@/lib/types";

const DEMO_GUILD_ID = "system-demo";
const DEMO_CAMPAIGN_SLUG = "demo";

const DEMO_SESSIONS: SessionSummary[] = [
  {
    id: "demo-s1",
    title: "Arrival at Moonwell Hollow",
    date: "2026-03-01",
    status: "completed",
    source: "live",
    artifacts: {
      transcript: "available",
      recap: "available",
    },
    warnings: [],
  },
  {
    id: "demo-s2",
    title: "The Lantern Archive Heist",
    date: "2026-03-05",
    status: "in_progress",
    source: "ingest",
    artifacts: {
      transcript: "available",
      recap: "available",
    },
    warnings: [],
  },
];

const DEMO_SESSION_DETAILS: Record<string, SessionDetail> = {
  "demo-s1": {
    id: "demo-s1",
    campaignSlug: DEMO_CAMPAIGN_SLUG,
    campaignName: "Demo Campaign",
    title: "Arrival at Moonwell Hollow",
    date: "2026-03-01",
    status: "completed",
    source: "live",
    guildId: DEMO_GUILD_ID,
    transcript: [
      {
        id: "demo-s1-line-1",
        speaker: "Dungeon Master",
        text: "Fog parts as Moonwell Hollow appears below your cliffside trail.",
        timestamp: "19:02",
      },
      {
        id: "demo-s1-line-2",
        speaker: "Ari (Ranger)",
        text: "I check the old watchtower for signs of recent movement.",
        timestamp: "19:11",
      },
      {
        id: "demo-s1-line-3",
        speaker: "Dungeon Master",
        text: "Fresh boot prints and a torn embercloak suggest the Ash Knives passed through.",
        timestamp: "19:17",
      },
    ],
    recap: {
      concise:
        "The party entered Moonwell Hollow, traced Ash Knife movement through the watchtower, and secured their first lead.",
      balanced:
        "Session one introduced Moonwell Hollow and set the party on the Ash Knives trail. Ari identified recent signs at the watchtower while the group stabilized relations with locals and established their first operational base.",
      detailed:
        "The campaign opened with a descent into Moonwell Hollow under low visibility and high tension. Ari's tower sweep confirmed Ash Knife presence through fresh tracks and discarded fabric. The party used that evidence to negotiate safe access to town records, map nearby routes, and establish a practical staging point for follow-up operations.",
      generatedAt: "2026-03-01T19:42:00.000Z",
      modelVersion: "demo-seeded-v1",
    },
    artifacts: {
      transcript: "available",
      recap: "available",
    },
    warnings: [],
  },
  "demo-s2": {
    id: "demo-s2",
    campaignSlug: DEMO_CAMPAIGN_SLUG,
    campaignName: "Demo Campaign",
    title: "The Lantern Archive Heist",
    date: "2026-03-05",
    status: "in_progress",
    source: "ingest",
    guildId: DEMO_GUILD_ID,
    transcript: [
      {
        id: "demo-s2-line-1",
        speaker: "Dungeon Master",
        text: "The Archive bells ring once; you have ten minutes before patrol rotates.",
        timestamp: "20:04",
      },
      {
        id: "demo-s2-line-2",
        speaker: "Nox (Rogue)",
        text: "I slip under the scribe desk and mirror the ward sigils from below.",
        timestamp: "20:07",
      },
      {
        id: "demo-s2-line-3",
        speaker: "Dungeon Master",
        text: "You bypass the first ward lattice and reveal a hidden ledger chamber.",
        timestamp: "20:13",
      },
    ],
    recap: {
      concise:
        "The crew infiltrated the Lantern Archive, bypassed outer wards, and exposed a hidden ledger chamber.",
      balanced:
        "In session two, the party executed a timed heist against the Lantern Archive. Nox neutralized key sigils while the group managed patrol timing. Their breakthrough uncovered a concealed ledger chamber tied to Ash Knife financing.",
      detailed:
        "The Lantern Archive heist escalated campaign stakes with a precision infiltration under patrol pressure. After a controlled entry, Nox mirrored ward signatures to open the interior path. The party coordinated timing and cover positions to avoid alarm triggers, ultimately discovering a hidden ledger chamber that reframed the Ash Knife threat as organized and funded.",
      generatedAt: "2026-03-05T20:34:00.000Z",
      modelVersion: "demo-seeded-v1",
    },
    artifacts: {
      transcript: "available",
      recap: "available",
    },
    warnings: [],
  },
};

export function getDemoCampaignSummary(): CampaignSummary {
  return {
    slug: DEMO_CAMPAIGN_SLUG,
    name: "Demo Campaign",
    guildName: "System Demo",
    description: "Guided sample archive with example sessions, recaps, and compendium entries.",
    sessionCount: DEMO_SESSIONS.length,
    lastSessionDate: DEMO_SESSIONS[0]?.date ?? null,
    sessions: DEMO_SESSIONS,
    type: "system",
    editable: false,
    persisted: false,
  };
}

export function getDemoSessionDetail(sessionId: string): SessionDetail | null {
  return DEMO_SESSION_DETAILS[sessionId] ?? null;
}

export function isDemoSessionId(sessionId: string): boolean {
  return sessionId in DEMO_SESSION_DETAILS;
}
