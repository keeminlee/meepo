import { notFound } from "next/navigation";
import { CampaignOverview } from "@/components/campaign/campaign-overview";
import { ArchiveShell } from "@/components/layout/archive-shell";
import { listCampaigns, getCampaignDetail } from "@/lib/server/readers";

type PageProps = {
  params: Promise<{ campaignSlug: string }>;
};

export async function generateStaticParams() {
  const campaigns = await listCampaigns();
  return campaigns.map((campaign) => ({ campaignSlug: campaign.slug }));
}

export default async function CampaignPage({ params }: PageProps) {
  const { campaignSlug } = await params;
  const campaign = await getCampaignDetail(campaignSlug);

  if (!campaign) {
    notFound();
  }

  return (
    <ArchiveShell section="Campaign" activePath="/campaigns" campaignName={campaign.name}>
      <CampaignOverview campaign={campaign} />
    </ArchiveShell>
  );
}
