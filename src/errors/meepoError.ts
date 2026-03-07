import type { ObservabilityContext } from "../observability/context.js";

export const MEEPO_ERROR_CODES = [
  "ERR_UNKNOWN",
  "ERR_INTERNAL_RUNTIME_FAILURE",
  "ERR_DISCORD_REPLY_FAILED",
  "ERR_DB_BUSY",
  "ERR_WORKER_STALE_LEASE",
  "ERR_LLM_TIMEOUT",
  "ERR_LLM_RATE_LIMIT",
  "ERR_STT_FAILED",
  "ERR_TTS_FAILED",
  "ERR_ARTIFACT_WRITE_FAILED",
  "ERR_INVALID_STATE",
  "ERR_SESSION_CONFLICT",
  "ERR_RECAP_IN_PROGRESS",
  "ERR_RECAP_RATE_LIMITED",
  "ERR_RECAP_CAPACITY_REACHED",
  "ERR_STALE_INTERACTION",
  "ERR_TRANSCRIPT_UNAVAILABLE",
  "ERR_NO_ACTIVE_SESSION",
  "ERR_AWAKEN_MODEL",
  "ERR_AWAKEN_PROMPT",
  "ERR_AWAKEN_MODAL",
  "ERR_AWAKEN_STATE",
  "ERR_AWAKEN_RESUME",
  "ERR_AWAKEN_UNKNOWN",
] as const;

export type MeepoErrorCode = (typeof MEEPO_ERROR_CODES)[number];

export type MeepoErrorOptions = {
  message?: string;
  userMessage?: string;
  metadata?: Record<string, unknown>;
  cause?: unknown;
  trace_id?: string;
  interaction_id?: string;
};

export class MeepoError extends Error {
  readonly code: MeepoErrorCode;
  readonly userMessage?: string;
  readonly metadata?: Record<string, unknown>;
  readonly trace_id?: string;
  readonly interaction_id?: string;

  constructor(code: MeepoErrorCode, opts?: MeepoErrorOptions) {
    super(opts?.message ?? code, opts?.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "MeepoError";
    this.code = code;
    this.userMessage = opts?.userMessage;
    this.metadata = opts?.metadata;
    this.trace_id = opts?.trace_id;
    this.interaction_id = opts?.interaction_id;
  }
}

export function toMeepoError(err: unknown, fallbackCode: MeepoErrorCode = "ERR_UNKNOWN"): MeepoError {
  if (err instanceof MeepoError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new MeepoError(fallbackCode, { message, cause: err });
}

export function applyErrorContext(err: MeepoError, context: ObservabilityContext): MeepoError {
  if (!context.trace_id && !context.interaction_id) return err;
  return new MeepoError(err.code, {
    message: err.message,
    userMessage: err.userMessage,
    metadata: err.metadata,
    cause: err.cause,
    trace_id: err.trace_id ?? context.trace_id,
    interaction_id: err.interaction_id ?? context.interaction_id,
  });
}
