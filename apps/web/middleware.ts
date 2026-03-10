import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const CANONICAL_HOST = "meepo.online";
const CANONICAL_ORIGIN = `https://${CANONICAL_HOST}`;

function normalizeHost(value: string): string {
  return value.trim().toLowerCase();
}

function toHostname(host: string): string {
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end > 0 ? host.slice(1, end) : host;
  }

  const [hostname] = host.split(":");
  return hostname ?? host;
}

function shouldBypassCanonicalRedirect(host: string): boolean {
  return host === "localhost"
    || host.startsWith("localhost:")
    || host === "127.0.0.1"
    || host.startsWith("127.0.0.1:")
    || host === "::1"
    || host.startsWith("::1:");
}

export function middleware(request: NextRequest): NextResponse {
  if (process.env.NODE_ENV !== "production") {
    return NextResponse.next();
  }

  const host = normalizeHost(request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "");
  const hostname = toHostname(host);
  if (!hostname || shouldBypassCanonicalRedirect(hostname)) {
    return NextResponse.next();
  }

  if (hostname === CANONICAL_HOST) {
    return NextResponse.next();
  }

  const destination = new URL(request.nextUrl.pathname + request.nextUrl.search, CANONICAL_ORIGIN);
  return NextResponse.redirect(destination, 308);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
