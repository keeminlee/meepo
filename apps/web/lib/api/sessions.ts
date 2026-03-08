import { fetchJson } from "@/lib/api/http";
import type {
  RegenerateSessionRecapRequest,
  RegenerateSessionRecapResponse,
  SessionDetailResponse,
  SessionRecapResponse,
  SessionTranscriptResponse,
} from "@/lib/api/types";

type QueryInput = Record<string, string | string[] | undefined> | undefined;

function toQuery(input: QueryInput): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  if (!input) return out;
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

export async function getSessionDetailApi(
  sessionId: string,
  searchParams?: QueryInput
): Promise<SessionDetailResponse> {
  return fetchJson<SessionDetailResponse>(`/api/sessions/${encodeURIComponent(sessionId)}`, {
    query: toQuery(searchParams),
  });
}

export async function getSessionTranscriptApi(
  sessionId: string,
  searchParams?: QueryInput
): Promise<SessionTranscriptResponse> {
  return fetchJson<SessionTranscriptResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/transcript`, {
    query: toQuery(searchParams),
  });
}

export async function getSessionRecapApi(
  sessionId: string,
  searchParams?: QueryInput
): Promise<SessionRecapResponse> {
  return fetchJson<SessionRecapResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/recap`, {
    query: toQuery(searchParams),
  });
}

export async function regenerateSessionRecapApi(
  sessionId: string,
  payload: RegenerateSessionRecapRequest,
  searchParams?: QueryInput
): Promise<RegenerateSessionRecapResponse> {
  return fetchJson<RegenerateSessionRecapResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/regenerate`, {
    method: "POST",
    query: toQuery(searchParams),
    body: payload,
  });
}
