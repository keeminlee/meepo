import { fetchJson } from "@/lib/api/http";
import type {
  CampaignRegistryResponse,
  RegistryCreateEntryApiRequest,
  RegistryPendingActionApiRequest,
  RegistryUpdateEntryApiRequest,
} from "@/lib/api/types";

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

export async function getCampaignRegistryApi(
  campaignSlug: string,
  searchParams?: QueryInput
): Promise<CampaignRegistryResponse> {
  return fetchJson<CampaignRegistryResponse>(
    `/api/campaigns/${encodeURIComponent(campaignSlug)}/registry`,
    {
      query: toQuery(searchParams),
    }
  );
}

export async function createCampaignRegistryEntryApi(
  campaignSlug: string,
  body: RegistryCreateEntryApiRequest,
  searchParams?: QueryInput
): Promise<CampaignRegistryResponse> {
  return fetchJson<CampaignRegistryResponse>(
    `/api/campaigns/${encodeURIComponent(campaignSlug)}/registry`,
    {
      method: "POST",
      body,
      query: toQuery(searchParams),
    }
  );
}

export async function updateCampaignRegistryEntryApi(
  campaignSlug: string,
  entryId: string,
  body: RegistryUpdateEntryApiRequest,
  searchParams?: QueryInput
): Promise<CampaignRegistryResponse> {
  return fetchJson<CampaignRegistryResponse>(
    `/api/campaigns/${encodeURIComponent(campaignSlug)}/registry/entries/${encodeURIComponent(entryId)}`,
    {
      method: "PATCH",
      body,
      query: toQuery(searchParams),
    }
  );
}

export async function applyCampaignRegistryPendingActionApi(
  campaignSlug: string,
  body: RegistryPendingActionApiRequest,
  searchParams?: QueryInput
): Promise<CampaignRegistryResponse> {
  return fetchJson<CampaignRegistryResponse>(
    `/api/campaigns/${encodeURIComponent(campaignSlug)}/registry/pending`,
    {
      method: "POST",
      body,
      query: toQuery(searchParams),
    }
  );
}
