import type { CampaignSummary, DashboardModel, SessionDetail } from "@/lib/types";

const SESSIONS: SessionDetail[] = [
  {
    id: "s1",
    guildId: "guild-recaps-api",
    campaignSlug: "shattered-crown",
    campaignName: "The Shattered Crown",
    title: "The Frozen Pass",
    date: "2026-01-14",
    status: "completed",
    source: "live",
    transcript: [
      {
        id: "t1",
        speaker: "DM",
        text: "The wind howls around you as you reach the narrowest part of the pass.",
        timestamp: "00:05",
      },
      {
        id: "t2",
        speaker: "Kaelen",
        text: "I check the ground for any signs of recent passage.",
        timestamp: "00:07",
      },
      {
        id: "t3",
        speaker: "DM",
        text: "Roll for Survival.",
        timestamp: "00:08",
      },
      {
        id: "t4",
        speaker: "Kaelen",
        text: "That is a 19.",
        timestamp: "00:10",
      },
      {
        id: "t5",
        speaker: "DM",
        text: "You see faint tracks, mostly covered by fresh snow, but they look small and numerous.",
        timestamp: "00:12",
      },
    ],
    recap: {
      concise: "The party crossed the pass and defeated an ice mephit ambush.",
      balanced:
        "After a difficult climb through the Frozen Pass, the party fought off ice mephits and discovered a mysterious silver locket buried in the snow.",
      detailed:
        "The session opened with worsening weather at the base of the Frozen Pass. Kaelen led navigation checks while the group rationed supplies. Midway through the ascent, four ice mephits ambushed from a windbreak ridge. Elara broke their formation with a fire spell and the party finished the encounter with minimal injuries. During recovery, Kaelen discovered a silver locket containing a faded portrait, suggesting prior traffic across the route. The group reached the far side by nightfall and established a temporary camp.",
      generatedAt: "2026-01-14T22:05:00.000Z",
      modelVersion: "megameecap-final-v1",
    },
    artifacts: {
      transcript: "available",
      recap: "available",
    },
    warnings: [],
  },
  {
    id: "s2",
    guildId: "guild-recaps-api",
    campaignSlug: "shattered-crown",
    campaignName: "The Shattered Crown",
    title: "The Whispering Woods",
    date: "2026-01-21",
    status: "completed",
    source: "live",
    transcript: [
      {
        id: "t6",
        speaker: "Silas",
        text: "Few come this deep into the whispers. What do you seek?",
        timestamp: "00:45",
      },
      {
        id: "t7",
        speaker: "Elara",
        text: "We seek the truth of the Shattered Crown.",
        timestamp: "00:47",
      },
      {
        id: "t8",
        speaker: "Silas",
        text: "Truth is a heavy burden. Are you ready to carry it?",
        timestamp: "00:50",
      },
    ],
    recap: {
      concise: "The party entered the Whispering Woods and claimed the first crown fragment.",
      balanced:
        "The party met the hermit Silas, solved his riddle, and located the Altar of Echoes where the first sapphire fragment of the Shattered Crown was guarded.",
      detailed:
        "The Whispering Woods route introduced social and narrative pressure before combat. Silas challenged the party with a time-based riddle and granted passage after Elara solved it immediately. At the Altar of Echoes, a spectral guardian attempted to bind the party to an oath. They broke the guardian's stance in two rounds and revealed the first sapphire fragment beneath the altar stone, establishing the first concrete recovery milestone in the campaign arc.",
      generatedAt: "2026-01-21T22:15:00.000Z",
      modelVersion: "megameecap-final-v1",
    },
    artifacts: {
      transcript: "available",
      recap: "available",
    },
    warnings: [],
  },
];

const CAMPAIGNS: CampaignSummary[] = [
  {
    slug: "shattered-crown",
    name: "The Shattered Crown",
    guildName: "Northern Table",
    description:
      "A journey through the frozen wastes of the north to recover the fragments of the ancient crown.",
    sessionCount: 2,
    lastSessionDate: "2026-01-21",
    sessions: SESSIONS.map((session) => ({
      id: session.id,
      title: session.title,
      date: session.date,
      status: session.status,
      source: session.source,
      artifacts: {
        transcript: session.artifacts.transcript,
        recap: session.artifacts.recap,
      },
      warnings: session.warnings,
    })),
  },
];

export const MOCK_DASHBOARD: DashboardModel = {
  totalSessions: SESSIONS.length,
  campaignCount: CAMPAIGNS.length,
  wordsRecorded: 45281,
  campaigns: CAMPAIGNS,
};

export function getMockCampaigns(): CampaignSummary[] {
  return CAMPAIGNS;
}

export function getMockSessionById(sessionId: string): SessionDetail | null {
  return SESSIONS.find((session) => session.id === sessionId) ?? null;
}

export function getMockCampaignBySlug(campaignSlug: string): CampaignSummary | null {
  return CAMPAIGNS.find((campaign) => campaign.slug === campaignSlug) ?? null;
}
