import { resolveWebAuthContext, type WebAuthorizedGuild } from "@/lib/server/authContext";
import { WebAuthError } from "@/lib/server/authContext";
import { prettifyCampaignSlug, formatSessionDisplayTitle } from "@/lib/campaigns/display";
import {
  getGuildCampaignDisplayName,
  getGuildCampaignSlugDiagnostic,
  isCampaignSlugOwnedByGuild,
  listSessionsForGuildCampaign,
  readSessionRecap,
  readSessionTranscript,
} from "@/lib/server/readData/archiveReadStore";
import { getDemoCampaignSummary } from "@/lib/server/demoCampaign";
import { ScopeGuardError } from "@/lib/server/scopeGuards";
import type { CampaignSummary, DashboardModel, SessionArtifactStatus, SessionSummary } from "@/lib/types";

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

const UNKNOWN_GUILD_DISPLAY_NAME = "Authorized Guild";

function resolveGuildDisplayName(guildName?: string): string {
  const trimmed = guildName?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : UNKNOWN_GUILD_DISPLAY_NAME;
}

function buildCampaignDescription(guildDisplayName: string): string {
  return `Canonical archive stream for ${guildDisplayName}.`;
}

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
        label: row.label,
        title: formatSessionDisplayTitle({ label: row.label, sessionId: row.session_id }),
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

  const campaignName = getGuildCampaignDisplayName({ guildId: args.guildId, campaignSlug })
    ?? prettifyCampaignSlug(campaignSlug);
  const guildDisplayName = resolveGuildDisplayName(args.guildName);

  const campaign: CampaignSummary = {
    slug: campaignSlug,
    name: campaignName,
    guildName: guildDisplayName,
    description: buildCampaignDescription(guildDisplayName),
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

  for (const guildId of auth.authorizedGuildIds) {
    if (!isCampaignSlugOwnedByGuild({ guildId, campaignSlug: args.campaignSlug })) {
      continue;
    }

    const detail = await listWebCampaignForGuild({
      guildId,
      guildName: auth.authorizedGuilds.find((guild) => guild.id === guildId)?.name,
    });

    if (detail?.campaign.slug === args.campaignSlug) {
      return {
        ...detail.campaign,
        name: getGuildCampaignDisplayName({ guildId, campaignSlug: args.campaignSlug })
          ?? prettifyCampaignSlug(args.campaignSlug),
      };
    }

    const sessions = await listWebSessionsForCampaign({
      guildId,
      campaignSlug: args.campaignSlug,
      limit: 50,
    });
    const guildDisplayName = resolveGuildDisplayName(auth.authorizedGuilds.find((guild) => guild.id === guildId)?.name);

    return {
      slug: args.campaignSlug,
      name: getGuildCampaignDisplayName({ guildId, campaignSlug: args.campaignSlug })
        ?? prettifyCampaignSlug(args.campaignSlug),
      guildName: guildDisplayName,
      description: buildCampaignDescription(guildDisplayName),
      sessionCount: sessions.length,
      lastSessionDate: sessions[0]?.session.date ?? null,
      sessions: sessions.map((entry) => entry.session),
      type: "user",
      editable: true,
      persisted: true,
    };
  }

  return null;
}

export async function updateWebCampaignName(args: {
  campaignSlug: string;
  campaignName: string;
  searchParams?: Record<string, string | string[] | undefined>;
}): Promise<CampaignSummary> {
  const auth = await resolveWebAuthContext(args.searchParams);
  const campaignSlug = args.campaignSlug.trim();
  const campaignName = args.campaignName.trim();

  if (!campaignSlug) {
    throw new ScopeGuardError("Campaign is out of scope for the authorized guild set.");
  }

  if (!campaignName) {
    throw new Error("campaignName cannot be empty.");
  }

  if (campaignName.length > 100) {
    throw new Error("campaignName exceeds max length (100).");
  }

  let ownerGuildId: string | null = null;
  for (const guildId of auth.authorizedGuildIds) {
    if (isCampaignSlugOwnedByGuild({ guildId, campaignSlug })) {
      ownerGuildId = guildId;
      break;
    }
  }

  // Upsert is allowed only after proving campaign slug ownership in authorized guild scope.
  if (!ownerGuildId) {
    throw new ScopeGuardError("Campaign is out of scope for the authorized guild set.");
  }

  const { getControlDb } = await import("../../../../src/db.js");
  const db = getControlDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO guild_campaigns (guild_id, campaign_slug, campaign_name, created_at_ms, created_by_user_id)
     VALUES (?, ?, ?, ?, NULL)
     ON CONFLICT(guild_id, campaign_slug)
     DO UPDATE SET campaign_name = excluded.campaign_name`
  ).run(ownerGuildId, campaignSlug, campaignName, now);

  const updated = await getWebCampaignDetail({
    campaignSlug,
    searchParams: args.searchParams,
  });

  if (!updated) {
    throw new ScopeGuardError("Campaign is out of scope for the authorized guild set.");
  }

  return updated;
}