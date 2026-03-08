export type CapabilityCode = "openai_unconfigured" | "discord_refresh_unconfigured";

export class CapabilityUnavailableError extends Error {
  readonly code: CapabilityCode;
  readonly status = 503;

  constructor(code: CapabilityCode, message: string) {
    super(message);
    this.name = "CapabilityUnavailableError";
    this.code = code;
  }
}

export function assertOpenAiConfigured(): void {
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.trim().length === 0) {
    throw new CapabilityUnavailableError(
      "openai_unconfigured",
      "Recap regeneration is unavailable because OPENAI_API_KEY is not configured."
    );
  }
}
