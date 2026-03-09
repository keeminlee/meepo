import { NextRequest, NextResponse } from "next/server";
import { readSearchParams, jsonError } from "@/app/api/_utils";
import { toSessionDetailDto } from "@/lib/mappers/campaignMappers";
import { getWebSessionDetail, updateWebSessionLabel } from "@/lib/server/sessionReaders";
import type { UpdateSessionLabelRequest } from "@/lib/api/types";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { sessionId } = await context.params;
    const searchParams = readSearchParams(request);
    const session = await getWebSessionDetail({ sessionId, searchParams });
    return NextResponse.json({ session: toSessionDetailDto(session) }, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { sessionId } = await context.params;
    const searchParams = readSearchParams(request);
    const body = (await request.json()) as UpdateSessionLabelRequest;
    const session = await updateWebSessionLabel({
      sessionId,
      label: body.label,
      searchParams,
    });
    return NextResponse.json({ session: toSessionDetailDto(session) }, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
