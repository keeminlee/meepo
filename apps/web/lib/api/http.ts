import type { ApiErrorResponse } from "@/lib/api/types";

type QueryValue = string | number | boolean | null | undefined;

type FetchJsonOptions = {
  method?: "GET" | "POST" | "PATCH";
  query?: Record<string, QueryValue | QueryValue[]>;
  body?: unknown;
  headers?: Record<string, string>;
};

export class WebApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "WebApiError";
    this.status = status;
    this.code = code;
  }
}

function appendQuery(url: URL, query?: FetchJsonOptions["query"]): void {
  if (!query) return;

  for (const [key, raw] of Object.entries(query)) {
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (item === null || item === undefined) continue;
        url.searchParams.append(key, String(item));
      }
      continue;
    }
    if (raw === null || raw === undefined) continue;
    url.searchParams.set(key, String(raw));
  }
}

async function resolveApiBaseUrl(): Promise<string> {
  if (typeof window !== "undefined") {
    return "";
  }

  const fromEnv = process.env.MEEPO_WEB_INTERNAL_ORIGIN ?? process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv.replace(/\/$/, "");
  }

  try {
    const nextHeaders = await import("next/headers");
    const headerStore = await nextHeaders.headers();
    const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
    const proto = headerStore.get("x-forwarded-proto") ?? "http";
    if (host) {
      return `${proto}://${host}`;
    }
  } catch {
    // Fallback below.
  }

  return "http://localhost:3000";
}

async function resolveServerCookieHeader(): Promise<string | null> {
  if (typeof window !== "undefined") {
    return null;
  }

  try {
    const nextHeaders = await import("next/headers");
    const headerStore = await nextHeaders.headers();
    return headerStore.get("cookie");
  } catch {
    // No request header context is available (for example during static tasks).
    return null;
  }
}

function toErrorMessage(status: number, fallbackMessage: string): string {
  if (status === 401) return "Unauthorized request.";
  if (status === 404) return "Requested resource was not found.";
  return fallbackMessage;
}

export async function fetchJson<T>(path: string, options: FetchJsonOptions = {}): Promise<T> {
  const baseUrl = await resolveApiBaseUrl();
  const url = new URL(path, baseUrl || "http://localhost");
  appendQuery(url, options.query);
  const cookie = await resolveServerCookieHeader();

  const response = await fetch(baseUrl ? url.toString() : `${path}${url.search}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(cookie && !options.headers?.cookie ? { cookie } : {}),
      ...(options.headers ?? {}),
    },
    cache: "no-store",
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    let payload: ApiErrorResponse | null = null;
    try {
      payload = (await response.json()) as ApiErrorResponse;
    } catch {
      payload = null;
    }

    const code = payload?.error?.code ?? "internal";
    const message = payload?.error?.message ?? toErrorMessage(response.status, "Request failed.");
    throw new WebApiError(response.status, code, message);
  }

  return (await response.json()) as T;
}
