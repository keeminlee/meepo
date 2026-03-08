import { NextRequest, NextResponse } from "next/server";
import { readSearchParams, jsonError } from "@/app/api/_utils";
import { getWebSessionDetail } from "@/lib/server/sessionReaders";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { sessionId } = await context.params;
    const searchParams = readSearchParams(request);
    const session = await getWebSessionDetail({ sessionId, searchParams });

    return NextResponse.json(
      {
        sessionId: session.id,
        campaignSlug: session.campaignSlug,
        status: session.artifacts.recap,
        warnings: session.warnings,
        recap: session.recap,
      },
      { status: 200 }
    );
  } catch (error) {
    return jsonError(error);
  }
}
