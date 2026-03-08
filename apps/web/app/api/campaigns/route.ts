import { NextRequest, NextResponse } from "next/server";
import { readSearchParams, jsonError } from "@/app/api/_utils";
import { toDashboardDto } from "@/lib/mappers/campaignMappers";
import { getWebDashboardModel } from "@/lib/server/campaignReaders";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const searchParams = readSearchParams(request);
    const dashboard = await getWebDashboardModel({ searchParams });
    return NextResponse.json({ dashboard: toDashboardDto(dashboard) }, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
