import type { CampaignSummary, DashboardModel, SessionDetail } from "@/lib/types";

function normalizeWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

export function toCampaignSummaryDto(campaign: CampaignSummary): CampaignSummary {
  return {
    ...campaign,
    sessions: campaign.sessions.map((session) => ({
      ...session,
      warnings: normalizeWarnings(session.warnings),
    })),
  };
}

export function toDashboardDto(model: DashboardModel): DashboardModel {
  return {
    ...model,
    campaigns: model.campaigns.map(toCampaignSummaryDto),
  };
}

export function toSessionDetailDto(session: SessionDetail): SessionDetail {
  return {
    ...session,
    warnings: normalizeWarnings(session.warnings),
    transcript: session.transcript.map((entry) => ({ ...entry })),
    recap: session.recap
      ? {
          ...session.recap,
        }
      : null,
  };
}
