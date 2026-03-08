import type { CampaignSummary, DashboardModel, SessionDetail, SessionRecap, TranscriptEntry } from "@/lib/types";
import type {
  RegistryCreateEntryRequest,
  RegistryPendingActionRequest,
  RegistrySnapshotDto,
  RegistryUpdateEntryRequest,
} from "@/lib/registry/types";

export type ApiErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

export type CampaignsResponse = {
  dashboard: DashboardModel;
};

export type CampaignSessionsResponse = {
  campaign: CampaignSummary;
};

export type SessionDetailResponse = {
  session: SessionDetail;
};

export type SessionTranscriptResponse = {
  sessionId: string;
  campaignSlug: string;
  status: SessionDetail["artifacts"]["transcript"];
  warnings: string[];
  lineCount: number;
  transcript: TranscriptEntry[];
};

export type SessionRecapResponse = {
  sessionId: string;
  campaignSlug: string;
  status: SessionDetail["artifacts"]["recap"];
  warnings: string[];
  recap: SessionRecap | null;
};

export type RegenerateSessionRecapRequest = {
  reason?: string;
};

export type RegenerateSessionRecapResponse = SessionRecapResponse;

export type CampaignRegistryResponse = {
  registry: RegistrySnapshotDto;
};

export type RegistryCreateEntryApiRequest = RegistryCreateEntryRequest;

export type RegistryUpdateEntryApiRequest = RegistryUpdateEntryRequest;

export type RegistryPendingActionApiRequest = RegistryPendingActionRequest;
