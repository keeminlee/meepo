import { getObservabilityContext } from "../observability/context.js";
import { MeepoError, type MeepoErrorCode, toMeepoError } from "./meepoError.js";

const DEFAULT_USER_MESSAGE = "⚠️ Meepo stumbled while writing this memory.";

export type UserFacingFailureClass = "retryable" | "corrective" | "internal";

type FailureContract = {
  message: string;
  failureClass: UserFacingFailureClass;
  retryable: boolean;
  correctiveActionRequired: boolean;
};

const CODE_FAILURE_CONTRACTS: Partial<Record<MeepoErrorCode, FailureContract>> = {
  ERR_LLM_TIMEOUT: {
    message: "⚠️ Meepo timed out while thinking.",
    failureClass: "retryable",
    retryable: true,
    correctiveActionRequired: false,
  },
  ERR_LLM_RATE_LIMIT: {
    message: "⚠️ Meepo is throttled right now. Please try again in a moment.",
    failureClass: "retryable",
    retryable: true,
    correctiveActionRequired: false,
  },
  ERR_TTS_FAILED: {
    message: "⚠️ Meepo couldn't speak that response out loud.",
    failureClass: "retryable",
    retryable: true,
    correctiveActionRequired: false,
  },
  ERR_STT_FAILED: {
    message: "⚠️ Meepo couldn't understand the voice input.",
    failureClass: "retryable",
    retryable: true,
    correctiveActionRequired: false,
  },
  ERR_SESSION_CONFLICT: {
    message: "⚠️ Session state changed while handling your request. Please refresh and try again.",
    failureClass: "corrective",
    retryable: false,
    correctiveActionRequired: true,
  },
  ERR_RECAP_IN_PROGRESS: {
    message: "⚠️ A recap for this session is already being generated.",
    failureClass: "retryable",
    retryable: true,
    correctiveActionRequired: false,
  },
  ERR_RECAP_RATE_LIMITED: {
    message: "⚠️ That recap was requested very recently. Please wait a moment before retrying.",
    failureClass: "retryable",
    retryable: true,
    correctiveActionRequired: false,
  },
  ERR_RECAP_CAPACITY_REACHED: {
    message: "⚠️ Recap generation is currently at capacity. Please retry shortly.",
    failureClass: "retryable",
    retryable: true,
    correctiveActionRequired: false,
  },
  ERR_STALE_INTERACTION: {
    message: "⚠️ This request expired before it could finish. Please run the command again from scratch.",
    failureClass: "corrective",
    retryable: false,
    correctiveActionRequired: true,
  },
  ERR_TRANSCRIPT_UNAVAILABLE: {
    message: "⚠️ Transcript data is currently unavailable for this session.",
    failureClass: "corrective",
    retryable: false,
    correctiveActionRequired: true,
  },
  ERR_NO_ACTIVE_SESSION: {
    message: "⚠️ Meepo could not resolve that session. Pick a session from `/meepo sessions list` and try again.",
    failureClass: "corrective",
    retryable: false,
    correctiveActionRequired: true,
  },
  ERR_INTERNAL_RUNTIME_FAILURE: {
    message: "⚠️ Meepo hit an internal runtime failure.",
    failureClass: "internal",
    retryable: false,
    correctiveActionRequired: false,
  },
  ERR_AWAKEN_MODEL: {
    message: "⚠️ Awakening failed while starting the scene engine.",
    failureClass: "internal",
    retryable: false,
    correctiveActionRequired: false,
  },
  ERR_AWAKEN_PROMPT: {
    message: "⚠️ Awakening prompt handling failed.",
    failureClass: "corrective",
    retryable: false,
    correctiveActionRequired: true,
  },
  ERR_AWAKEN_MODAL: {
    message: "⚠️ Awakening could not open or submit the modal prompt.",
    failureClass: "corrective",
    retryable: false,
    correctiveActionRequired: true,
  },
  ERR_AWAKEN_STATE: {
    message: "⚠️ Awakening state is invalid or stale.",
    failureClass: "corrective",
    retryable: false,
    correctiveActionRequired: true,
  },
  ERR_AWAKEN_RESUME: {
    message: "⚠️ Awakening resume failed after prompt submission.",
    failureClass: "corrective",
    retryable: false,
    correctiveActionRequired: true,
  },
  ERR_AWAKEN_UNKNOWN: {
    message: "⚠️ Awakening failed unexpectedly.",
    failureClass: "internal",
    retryable: false,
    correctiveActionRequired: false,
  },
};

export type UserFacingErrorContext = {
  fallbackMessage?: string;
  trace_id?: string;
  interaction_id?: string;
};

export type UserFacingErrorPayload = {
  content: string;
  code: MeepoErrorCode;
  failureClass: UserFacingFailureClass;
  retryable: boolean;
  correctiveActionRequired: boolean;
  trace_id?: string;
};

function withRetryAfterIfPresent(message: string, err: MeepoError): string {
  const retryAfterSeconds = Number(err.metadata?.retry_after_seconds);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return `${message} Please wait about ${Math.ceil(retryAfterSeconds)} seconds before retrying.`;
  }
  const retryAfterMs = Number(err.metadata?.retry_after_ms);
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    return `${message} Please wait about ${Math.ceil(retryAfterMs / 1000)} seconds before retrying.`;
  }
  return message;
}

function withCorrectiveHints(message: string, err: MeepoError): string {
  if (err.code !== "ERR_TRANSCRIPT_UNAVAILABLE") return message;

  const transcriptState = String(err.metadata?.transcript_state ?? "").trim();
  if (transcriptState === "missing_artifact") {
    return `${message} This usually means the session exists but no transcript artifact has been generated yet. Try again shortly or regenerate artifacts via /meepo sessions recap.`;
  }
  if (transcriptState === "export_failed") {
    return `${message} Meepo could not build a transcript export for that session yet. Retry shortly, or regenerate session artifacts and then view again.`;
  }
  if (transcriptState === "time_budget_exceeded") {
    return `${message} Transcript export exceeded the interaction time budget. Re-run the command from scratch.`;
  }
  return `${message} Try another session from /meepo sessions list, or retry after transcript export finishes.`;
}

export function formatUserFacingError(
  err: unknown,
  ctx?: UserFacingErrorContext
): UserFacingErrorPayload {
  const obs = getObservabilityContext();
  const known = err instanceof MeepoError ? err : toMeepoError(err, "ERR_UNKNOWN");

  const traceId = ctx?.trace_id ?? known.trace_id ?? obs.trace_id;
  const contract = CODE_FAILURE_CONTRACTS[known.code];
  const resolvedMessageBase =
    known.userMessage
    ?? contract?.message
    ?? ctx?.fallbackMessage
    ?? DEFAULT_USER_MESSAGE;
  const resolvedMessage = withCorrectiveHints(withRetryAfterIfPresent(resolvedMessageBase, known), known);
  const failureClass = contract?.failureClass ?? "internal";
  const retryable = contract?.retryable ?? false;
  const correctiveActionRequired = contract?.correctiveActionRequired ?? false;

  const contentLines = [resolvedMessage, `(${known.code})`];
  if (traceId) contentLines.push(`trace=${traceId}`);

  return {
    content: contentLines.join("\n"),
    code: known.code,
    failureClass,
    retryable,
    correctiveActionRequired,
    trace_id: traceId,
  };
}
