import { WebAuthError } from "@/lib/server/authContext";
import { CapabilityUnavailableError } from "@/lib/server/capabilityErrors";

export type WebDataErrorCode =
  | "unauthorized"
  | "not_found"
  | "invalid_request"
  | "conflict"
  | "transcript_unavailable"
  | "recap_unavailable"
  | "generation_failed"
  | "openai_unconfigured"
  | "discord_refresh_unconfigured"
  | "internal";

export class WebDataError extends Error {
  readonly code: WebDataErrorCode;
  readonly status: number;

  constructor(code: WebDataErrorCode, status: number, message: string, options?: { cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "WebDataError";
    this.code = code;
    this.status = status;
  }
}

export type WebErrorResponse = {
  error: {
    code: WebDataErrorCode;
    message: string;
  };
};

export function mapToWebDataError(error: unknown): WebDataError {
  if (error instanceof WebDataError) {
    return error;
  }

  if (error instanceof WebAuthError) {
    return new WebDataError("unauthorized", 401, error.message, { cause: error });
  }

  if (error instanceof CapabilityUnavailableError) {
    return new WebDataError(error.code, error.status, error.message, { cause: error });
  }

  const recapCode =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  if (recapCode === "SCOPE_VIOLATION") {
    const message = error instanceof Error ? error.message : String(error);
    return new WebDataError("not_found", 404, message, { cause: error });
  }
  if (recapCode.startsWith("RECAP_")) {
    const message = error instanceof Error ? error.message : String(error);
    if (recapCode === "RECAP_SESSION_NOT_FOUND") {
      return new WebDataError("not_found", 404, message, { cause: error });
    }
    if (recapCode === "RECAP_TRANSCRIPT_UNAVAILABLE") {
      return new WebDataError("transcript_unavailable", 424, message, { cause: error });
    }
    if (recapCode === "RECAP_GENERATION_FAILED") {
      return new WebDataError("generation_failed", 502, message, { cause: error });
    }
    return new WebDataError("recap_unavailable", 424, message, { cause: error });
  }

  const message = error instanceof Error ? error.message : String(error);
  if (/session not found/i.test(message)) {
    return new WebDataError("not_found", 404, message, { cause: error });
  }
  if (/transcript|no bronze transcript|no transcript/i.test(message)) {
    return new WebDataError("transcript_unavailable", 424, message, { cause: error });
  }

  if (/OPENAI_API_KEY|openai api key/i.test(message)) {
    return new WebDataError(
      "openai_unconfigured",
      503,
      "This action is unavailable until OPENAI_API_KEY is configured.",
      { cause: error }
    );
  }

  if (/DISCORD_TOKEN/i.test(message)) {
    return new WebDataError(
      "discord_refresh_unconfigured",
      503,
      "Discord refresh capability is unavailable because DISCORD_TOKEN is not configured.",
      { cause: error }
    );
  }

  return new WebDataError("internal", 500, message || "Unknown session data error", { cause: error });
}

export function toWebErrorResponse(error: unknown): {
  status: number;
  body: WebErrorResponse;
} {
  const mapped = mapToWebDataError(error);
  return {
    status: mapped.status,
    body: {
      error: {
        code: mapped.code,
        message: mapped.message,
      },
    },
  };
}
