import { describe, expect, test } from "vitest";
import { formatUserFacingError } from "../errors/formatUserFacingError.js";
import { MeepoError } from "../errors/meepoError.js";

describe("formatUserFacingError", () => {
  test("raw Error maps deterministically to ERR_UNKNOWN", () => {
    const payload = formatUserFacingError(new Error("boom"));
    expect(payload.code).toBe("ERR_UNKNOWN");
    expect(payload.failureClass).toBe("internal");
    expect(payload.retryable).toBe(false);
    expect(payload.content).toContain("(ERR_UNKNOWN)");
    expect(payload.content).not.toContain("trace=");
  });

  test("MeepoError userMessage is preserved and includes code", () => {
    const payload = formatUserFacingError(
      new MeepoError("ERR_TTS_FAILED", {
        userMessage: "Voice output failed.",
        trace_id: "trace123",
      })
    );

    expect(payload.code).toBe("ERR_TTS_FAILED");
    expect(payload.failureClass).toBe("retryable");
    expect(payload.retryable).toBe(true);
    expect(payload.content).toContain("Voice output failed.");
    expect(payload.content).toContain("(ERR_TTS_FAILED)");
    expect(payload.content).toContain("trace=trace123");
  });

  test("code-only MeepoError gets deterministic fallback + optional trace override", () => {
    const payload = formatUserFacingError(new MeepoError("ERR_LLM_RATE_LIMIT"), {
      trace_id: "trace-override",
    });

    expect(payload.code).toBe("ERR_LLM_RATE_LIMIT");
    expect(payload.failureClass).toBe("retryable");
    expect(payload.retryable).toBe(true);
    expect(payload.content).toContain("(ERR_LLM_RATE_LIMIT)");
    expect(payload.content).toContain("trace=trace-override");
  });

  test("recap rate limited appends retry-after guidance from metadata", () => {
    const payload = formatUserFacingError(
      new MeepoError("ERR_RECAP_RATE_LIMITED", {
        metadata: { retry_after_seconds: 27 },
      })
    );

    expect(payload.code).toBe("ERR_RECAP_RATE_LIMITED");
    expect(payload.failureClass).toBe("retryable");
    expect(payload.retryable).toBe(true);
    expect(payload.correctiveActionRequired).toBe(false);
    expect(payload.content).toContain("requested very recently");
    expect(payload.content).toContain("27 seconds");
  });

  test("corrective taxonomy is stable for stale interaction", () => {
    const payload = formatUserFacingError(new MeepoError("ERR_STALE_INTERACTION"));

    expect(payload.code).toBe("ERR_STALE_INTERACTION");
    expect(payload.failureClass).toBe("corrective");
    expect(payload.retryable).toBe(false);
    expect(payload.correctiveActionRequired).toBe(true);
    expect(payload.content).toContain("expired");
  });

  test("transcript unavailable includes actionable missing artifact guidance", () => {
    const payload = formatUserFacingError(
      new MeepoError("ERR_TRANSCRIPT_UNAVAILABLE", {
        metadata: { transcript_state: "missing_artifact" },
      })
    );

    expect(payload.code).toBe("ERR_TRANSCRIPT_UNAVAILABLE");
    expect(payload.failureClass).toBe("corrective");
    expect(payload.retryable).toBe(false);
    expect(payload.correctiveActionRequired).toBe(true);
    expect(payload.content).toContain("no transcript artifact");
    expect(payload.content).toContain("web app");
  });

  test("no active session provides corrective next action", () => {
    const payload = formatUserFacingError(new MeepoError("ERR_NO_ACTIVE_SESSION"));

    expect(payload.code).toBe("ERR_NO_ACTIVE_SESSION");
    expect(payload.failureClass).toBe("corrective");
    expect(payload.retryable).toBe(false);
    expect(payload.correctiveActionRequired).toBe(true);
    expect(payload.content).toContain("web app");
    expect(payload.content).toContain("/starstory showtime start");
  });
});
