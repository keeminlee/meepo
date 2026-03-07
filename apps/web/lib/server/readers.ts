import {
  MOCK_DASHBOARD,
  getMockCampaignBySlug,
  getMockCampaigns,
  getMockSessionById,
} from "@/lib/mock/data";
import type { CampaignSummary, DashboardModel, SessionDetail } from "@/lib/types";

// B0 uses typed mock adapters only; B1 swaps internals to canonical session/transcript/recap readers.
export async function getDashboardModel(): Promise<DashboardModel> {
  return MOCK_DASHBOARD;
}

export async function listCampaigns(): Promise<CampaignSummary[]> {
  return getMockCampaigns();
}

export async function getCampaignDetail(campaignSlug: string): Promise<CampaignSummary | null> {
  return getMockCampaignBySlug(campaignSlug);
}

export async function getSessionDetail(sessionId: string): Promise<SessionDetail | null> {
  return getMockSessionById(sessionId);
}
