export type RecapTab = "concise" | "balanced" | "detailed";

export type SessionStatus = "completed" | "in_progress";

export type SessionArtifactStatus =
  | "available"
  | "missing"
  | "unavailable";

export type SessionSummary = {
  id: string;
  label: string | null;
  title: string;
  date: string;
  startedByUserId?: string | null;
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
  guildId: string | null;
  name: string;
  guildName: string;
  guildIconUrl?: string | null;
  isDm?: boolean;
  description: string;
  sessionCount: number;
  lastSessionDate: string | null;
  sessions: SessionSummary[];
  type?: "user" | "system";
  editable?: boolean;
  persisted?: boolean;
  canWrite?: boolean;
  readOnlyReason?: "not_campaign_dm" | "demo_mode";
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
  source?: "canonical" | "legacy_artifact" | "legacy_meecap";
};

export type SessionDetail = {
  id: string;
  campaignSlug: string;
  campaignName: string;
  label: string | null;
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
  canWrite?: boolean;
};

export type DashboardModel = {
  totalSessions: number;
  campaignCount: number;
  wordsRecorded: number;
  campaigns: CampaignSummary[];
  authState?:
    | "ok"
    | "unsigned"
    | "signed_in_no_authorized_guilds"
    | "signed_in_no_meepo_installed"
    | "signed_in_no_sessions";
};
