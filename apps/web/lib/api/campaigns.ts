import { fetchJson } from "@/lib/api/http";
import type { CampaignSessionsResponse, CampaignsResponse } from "@/lib/api/types";

type QueryInput = Record<string, string | string[] | undefined> | undefined;

function toQuery(input: QueryInput): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  if (!input) return out;
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

export async function getCampaignsApi(searchParams?: QueryInput): Promise<CampaignsResponse> {
  return fetchJson<CampaignsResponse>("/api/campaigns", {
    query: toQuery(searchParams),
  });
}

export async function getCampaignSessionsApi(
  campaignSlug: string,
  searchParams?: QueryInput
): Promise<CampaignSessionsResponse> {
  return fetchJson<CampaignSessionsResponse>(`/api/campaigns/${encodeURIComponent(campaignSlug)}/sessions`, {
    query: toQuery(searchParams),
  });
}
