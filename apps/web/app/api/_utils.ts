import { NextRequest, NextResponse } from "next/server";
import { toWebErrorResponse } from "@/lib/mappers/errorMappers";

export function readSearchParams(request: NextRequest): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {};

  for (const key of request.nextUrl.searchParams.keys()) {
    const all = request.nextUrl.searchParams.getAll(key);
    if (all.length === 0) continue;
    out[key] = all.length === 1 ? all[0] : all;
  }

  return out;
}

export function jsonError(error: unknown): NextResponse {
  const mapped = toWebErrorResponse(error);
  return NextResponse.json(mapped.body, { status: mapped.status });
}
