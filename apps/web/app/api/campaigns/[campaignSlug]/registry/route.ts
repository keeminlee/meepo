import { NextRequest, NextResponse } from "next/server";
import { jsonError, readSearchParams } from "@/app/api/_utils";
import {
  createWebRegistryEntry,
  getWebRegistrySnapshot,
} from "@/lib/server/registryService";
import type { RegistryCreateEntryRequest } from "@/lib/registry/types";

type RouteContext = {
  params: Promise<{ campaignSlug: string }>;
};

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { campaignSlug } = await context.params;
    const searchParams = readSearchParams(request);
    const registry = await getWebRegistrySnapshot({ campaignSlug, searchParams });
    return NextResponse.json({ registry }, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { campaignSlug } = await context.params;
    const searchParams = readSearchParams(request);
    const body = (await request.json()) as RegistryCreateEntryRequest;
    const registry = await createWebRegistryEntry({ campaignSlug, searchParams, body });
    return NextResponse.json({ registry }, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
