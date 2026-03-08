import { NextRequest, NextResponse } from "next/server";
import { jsonError, readSearchParams } from "@/app/api/_utils";
import { applyWebRegistryPendingAction } from "@/lib/server/registryService";
import type { RegistryPendingActionRequest } from "@/lib/registry/types";

type RouteContext = {
  params: Promise<{ campaignSlug: string }>;
};

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { campaignSlug } = await context.params;
    const searchParams = readSearchParams(request);
    const body = (await request.json()) as RegistryPendingActionRequest;
    const registry = await applyWebRegistryPendingAction({ campaignSlug, searchParams, body });
    return NextResponse.json({ registry }, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
