import { NextRequest, NextResponse } from "next/server";
import { readSearchParams, jsonError } from "@/app/api/_utils";
import { toCampaignSummaryDto } from "@/lib/mappers/campaignMappers";
import { WebDataError } from "@/lib/mappers/errorMappers";
import { getWebCampaignDetail } from "@/lib/server/campaignReaders";

type RouteContext = {
  params: Promise<{ campaignSlug: string }>;
};

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { campaignSlug } = await context.params;
    const searchParams = readSearchParams(request);
    const campaign = await getWebCampaignDetail({ campaignSlug, searchParams });

    if (!campaign) {
      throw new WebDataError("not_found", 404, `Campaign not found: ${campaignSlug}`);
    }

    return NextResponse.json({ campaign: toCampaignSummaryDto(campaign) }, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
