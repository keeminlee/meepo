import { NextRequest, NextResponse } from "next/server";
import { jsonError, readSearchParams } from "@/app/api/_utils";
import { updateWebRegistryEntry } from "@/lib/server/registryService";
import type { RegistryUpdateEntryRequest } from "@/lib/registry/types";

type RouteContext = {
  params: Promise<{ campaignSlug: string; entryId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { campaignSlug, entryId } = await context.params;
    const searchParams = readSearchParams(request);
    const body = (await request.json()) as RegistryUpdateEntryRequest;
    const registry = await updateWebRegistryEntry({
      campaignSlug,
      entryId,
      searchParams,
      body,
    });

    return NextResponse.json({ registry }, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
