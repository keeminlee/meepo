import { resolveWebAuthContext, type WebAuthorizedGuild } from "@/lib/server/authContext";
import { WebAuthError } from "@/lib/server/authContext";
import {
  getGuildCampaignSlugDiagnostic,
  listSessionsForGuildCampaign,
  readSessionRecap,
  readSessionTranscript,
} from "@/lib/server/readData/archiveReadStore";
import { getDemoCampaignSummary } from "@/lib/server/demoCampaign";
import type { CampaignSummary, DashboardModel, SessionArtifactStatus, SessionSummary } from "@/lib/types";

function titleCaseSlug(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

function buildArtifactStatus(args: {
  hasData: boolean;
  unavailable: boolean;
}): SessionArtifactStatus {
  if (args.hasData) return "available";
  return args.unavailable ? "unavailable" : "missing";
}

type SessionSummaryWithStats = {
  session: SessionSummary;
  wordCount: number;
};

export async function listWebSessionsForCampaign(args: {
  guildId: string;
  campaignSlug: string;
  limit?: number;
}): Promise<SessionSummaryWithStats[]> {
  const rows = listSessionsForGuildCampaign({
    guildId: args.guildId,
    campaignSlug: args.campaignSlug,
    limit: args.limit ?? 25,
  });

  return rows.map((row) => {
    let transcriptUnavailable = false;
    let recapUnavailable = false;
    let transcriptWordCount = 0;
    let hasTranscript = false;
    let hasRecap = false;
    const warnings: string[] = [];

    try {
      const transcript = readSessionTranscript({
        guildId: args.guildId,
        campaignSlug: args.campaignSlug,
        sessionId: row.session_id,
      });
      hasTranscript = Boolean(transcript && transcript.lineCount > 0);
      transcriptWordCount = transcript ? transcript.lines.reduce((sum, line) => sum + countWords(line.text), 0) : 0;
    } catch (error) {
      transcriptUnavailable = true;
      warnings.push(error instanceof Error ? error.message : String(error));
    }

    try {
      const recap = readSessionRecap({
        guildId: args.guildId,
        campaignSlug: args.campaignSlug,
        sessionId: row.session_id,
      });
      hasRecap = recap !== null;
    } catch (error) {
      recapUnavailable = true;
      warnings.push(error instanceof Error ? error.message : String(error));
    }

    return {
      session: {
        id: row.session_id,
        title: row.label ?? row.session_id,
        date: toIsoDate(row.started_at_ms),
        status: row.status === "active" ? "in_progress" : "completed",
        source: row.source === "ingest-media" ? "ingest" : "live",
        artifacts: {
          transcript: buildArtifactStatus({ hasData: hasTranscript, unavailable: transcriptUnavailable }),
          recap: buildArtifactStatus({ hasData: hasRecap, unavailable: recapUnavailable }),
        },
        warnings,
      },
      wordCount: transcriptWordCount,
    };
  });
}

async function listWebCampaignForGuild(args: {
  guildId: string;
  guildName?: string;
}): Promise<{ campaign: CampaignSummary; wordsRecorded: number } | null> {
  const slugDiagnostic = getGuildCampaignSlugDiagnostic(args.guildId);
  const campaignSlug = slugDiagnostic.normalizedCampaignSlug;

  if (!campaignSlug) {
    return null;
  }

  const sessions = await listWebSessionsForCampaign({
    guildId: args.guildId,
    campaignSlug,
    limit: 50,
  });

  const campaign: CampaignSummary = {
    slug: campaignSlug,
    name: titleCaseSlug(campaignSlug),
    guildName: args.guildName ?? args.guildId,
    description: `Canonical archive stream for guild ${args.guildId}.`,
    sessionCount: sessions.length,
    lastSessionDate: sessions[0]?.session.date ?? null,
    sessions: sessions.map((entry) => entry.session),
    type: "user",
    editable: true,
    persisted: true,
  };

  return {
    campaign,
    wordsRecorded: sessions.reduce((sum, entry) => sum + entry.wordCount, 0),
  };
}

export async function listWebCampaignsForGuilds(args: {
  authorizedGuildIds: string[];
  authorizedGuilds?: WebAuthorizedGuild[];
  includeDemoFallback?: boolean;
}): Promise<{ campaigns: CampaignSummary[]; wordsRecorded: number }> {
  const guildNameMap = new Map<string, string>();
  for (const guild of args.authorizedGuilds ?? []) {
    const id = guild.id.trim();
    if (!id) continue;
    if (guild.name?.trim()) {
      guildNameMap.set(id, guild.name);
    }
  }

  const seen = new Set<string>();
  const uniqueGuildIds = args.authorizedGuildIds.filter((guildId) => {
    const id = guildId.trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const results = await Promise.all(
    uniqueGuildIds.map((guildId) =>
      listWebCampaignForGuild({
        guildId,
        guildName: guildNameMap.get(guildId),
      })
    )
  );

  const campaigns: CampaignSummary[] = [];
  let wordsRecorded = 0;
  for (const item of results) {
    if (!item) continue;
    campaigns.push(item.campaign);
    wordsRecorded += item.wordsRecorded;
  }

  if (args.includeDemoFallback && campaigns.length === 0) {
    campaigns.push(getDemoCampaignSummary());
  }

  return { campaigns, wordsRecorded };
}

export async function getWebDashboardModel(args?: {
  searchParams?: Record<string, string | string[] | undefined>;
}): Promise<DashboardModel> {
  let auth = null as Awaited<ReturnType<typeof resolveWebAuthContext>> | null;
  try {
    auth = await resolveWebAuthContext(args?.searchParams);
  } catch (error) {
    if (error instanceof WebAuthError && error.reason === "unsigned") {
      const demoCampaign = getDemoCampaignSummary();
      return {
        totalSessions: demoCampaign.sessionCount,
        campaignCount: 1,
        wordsRecorded: 0,
        campaigns: [demoCampaign],
        authState: "unsigned_demo_fallback",
      };
    }
    throw error;
  }

  const model = await listWebCampaignsForGuilds({
    authorizedGuildIds: auth.authorizedGuildIds,
    authorizedGuilds: auth.authorizedGuilds,
    includeDemoFallback: false,
  });

  if (model.campaigns.length === 0) {
    return {
      totalSessions: 0,
      campaignCount: 0,
      wordsRecorded: 0,
      campaigns: [],
      authState: "signed_in_no_authorized_campaigns",
    };
  }

  return {
    totalSessions: model.campaigns.reduce((sum, campaign) => sum + campaign.sessionCount, 0),
    campaignCount: model.campaigns.length,
    wordsRecorded: model.wordsRecorded,
    campaigns: model.campaigns,
    authState: "ok",
  };
}

export async function getWebCampaignDetail(args: {
  campaignSlug: string;
  searchParams?: Record<string, string | string[] | undefined>;
}): Promise<CampaignSummary | null> {
  let auth = null as Awaited<ReturnType<typeof resolveWebAuthContext>> | null;
  try {
    auth = await resolveWebAuthContext(args.searchParams);
  } catch (error) {
    if (error instanceof WebAuthError && error.reason === "unsigned") {
      return args.campaignSlug === "demo" ? getDemoCampaignSummary() : null;
    }
    throw error;
  }

  const model = await listWebCampaignsForGuilds({
    authorizedGuildIds: auth.authorizedGuildIds,
    authorizedGuilds: auth.authorizedGuilds,
    includeDemoFallback: false,
  });
  return model.campaigns.find((campaign) => campaign.slug === args.campaignSlug) ?? null;
}