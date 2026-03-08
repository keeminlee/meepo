export type RecapTab = "concise" | "balanced" | "detailed";

export type SessionStatus = "completed" | "in_progress";

export type SessionArtifactStatus =
  | "available"
  | "missing"
  | "unavailable";

export type SessionSummary = {
  id: string;
  title: string;
  date: string;
  status: SessionStatus;
  source: "live" | "ingest";
  artifacts: {
    transcript: SessionArtifactStatus;
    recap: SessionArtifactStatus;
  };
  warnings: string[];
};

export type CampaignSummary = {
  slug: string;
  name: string;
  guildName: string;
  description: string;
  sessionCount: number;
  lastSessionDate: string | null;
  sessions: SessionSummary[];
  type?: "user" | "system";
  editable?: boolean;
  persisted?: boolean;
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
  guildId: string;
  transcript: TranscriptEntry[];
  recap: SessionRecap | null;
  artifacts: {
    transcript: SessionArtifactStatus;
    recap: SessionArtifactStatus;
  };
  warnings: string[];
};

export type DashboardModel = {
  totalSessions: number;
  campaignCount: number;
  wordsRecorded: number;
  campaigns: CampaignSummary[];
  authState?: "ok" | "unsigned_demo_fallback" | "signed_in_no_authorized_campaigns";
};
