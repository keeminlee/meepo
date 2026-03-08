import type { CampaignSummary, DashboardModel, SessionDetail } from "@/lib/types";

export async function getDashboardModel(searchParams?: Record<string, string | string[] | undefined>): Promise<DashboardModel> {
  const { getWebDashboardModel } = await import("@/lib/server/campaignReaders");
  return getWebDashboardModel({ searchParams });
}

export async function listCampaigns(searchParams?: Record<string, string | string[] | undefined>): Promise<CampaignSummary[]> {
  const { getWebDashboardModel } = await import("@/lib/server/campaignReaders");
  const model = await getWebDashboardModel({ searchParams });
  return model.campaigns;
}

export async function getCampaignDetail(
  campaignSlug: string,
  searchParams?: Record<string, string | string[] | undefined>
): Promise<CampaignSummary | null> {
  const { getWebCampaignDetail } = await import("@/lib/server/campaignReaders");
  return getWebCampaignDetail({ campaignSlug, searchParams });
}

export async function getSessionDetail(sessionId: string): Promise<SessionDetail | null> {
  try {
    const { getWebSessionDetail } = await import("@/lib/server/sessionReaders");
    return await getWebSessionDetail({ sessionId });
  } catch {
    return null;
  }
}
