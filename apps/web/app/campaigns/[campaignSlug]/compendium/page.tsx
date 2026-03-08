import { notFound } from "next/navigation";
import { ArchiveShell } from "@/components/layout/archive-shell";
import { CampaignRegistryManager } from "@/components/campaign/campaign-registry-manager";
import { WebApiError } from "@/lib/api/http";
import { getCampaignRegistryApi } from "@/lib/api/registry";
import { getCampaignSessionsApi } from "@/lib/api/campaigns";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ campaignSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CampaignCompendiumPage({ params, searchParams }: PageProps) {
  const { campaignSlug } = await params;
  const query = await searchParams;

  let campaign = null as Awaited<ReturnType<typeof getCampaignSessionsApi>>["campaign"] | null;
  try {
    const campaignResponse = await getCampaignSessionsApi(campaignSlug, query);
    campaign = campaignResponse.campaign;
  } catch (error) {
    if (error instanceof WebApiError && error.status === 404) {
      campaign = null;
    } else {
      throw error;
    }
  }

  if (!campaign) {
    notFound();
  }

  let registry = null as Awaited<ReturnType<typeof getCampaignRegistryApi>>["registry"] | null;
  try {
    const registryResponse = await getCampaignRegistryApi(campaignSlug, query);
    registry = registryResponse.registry;
  } catch (error) {
    if (error instanceof WebApiError && error.status === 404) {
      registry = null;
    } else {
      throw error;
    }
  }

  if (!registry) {
    notFound();
  }

  return (
    <ArchiveShell section="Compendium" campaignName={campaign.name}>
      <CampaignRegistryManager
        campaignSlug={campaignSlug}
        initialRegistry={registry}
        searchParams={query}
        isEditable={campaign.editable !== false}
      />
    </ArchiveShell>
  );
}
