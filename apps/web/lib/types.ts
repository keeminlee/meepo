export type RecapTab = "concise" | "balanced" | "detailed";

export type SessionStatus = "completed" | "in_progress";

export type SessionSummary = {
  id: string;
  title: string;
  date: string;
  status: SessionStatus;
  transcriptAvailable: boolean;
  recapAvailable: boolean;
};

export type CampaignSummary = {
  slug: string;
  name: string;
  guildName: string;
  description: string;
  sessionCount: number;
  lastSessionDate: string | null;
  sessions: SessionSummary[];
};

export type TranscriptEntry = {
  id: string;
  speaker: string;
  text: string;
  timestamp: string;
};

export type SessionRecap = {
  concise: string;
  balanced: string;
  detailed: string;
  generatedAt: string;
  modelVersion: string;
};

export type SessionDetail = {
  id: string;
  campaignSlug: string;
  campaignName: string;
  title: string;
  date: string;
  status: SessionStatus;
  source: "live" | "ingest";
  transcript: TranscriptEntry[];
  recap: SessionRecap | null;
};

export type DashboardModel = {
  totalSessions: number;
  campaignCount: number;
  wordsRecorded: number;
  campaigns: CampaignSummary[];
};
