import { resolveWebAuthContext, type WebAuthorizedGuild } from "@/lib/server/authContext";
import { WebAuthError } from "@/lib/server/authContext";
import { prettifyCampaignSlug, formatSessionDisplayTitle } from "@/lib/campaigns/display";
import {
  getGuildConfigState,
  getGuildCampaignDisplayName,
  getGuildCampaignSlugDiagnostic,
  isCampaignSlugOwnedByGuild,
  listGuildCampaignRecords,
  listSessionsForGuildCampaign,
  readSessionRecap,
  readSessionTranscript,
} from "@/lib/server/readData/archiveReadStore";
import { getDemoCampaignSummary } from "@/lib/server/demoCampaign";
import { ScopeGuardError } from "@/lib/server/scopeGuards";
import { WebDataError } from "@/lib/mappers/errorMappers";
import { assertUserCanWriteGuildArchive, canUserWriteGuildArchive } from "@/lib/server/writeAuthority";
import type { CampaignSummary, DashboardModel, SessionArtifactStatus, SessionSummary } from "@/lib/types";

type QueryInput = Record<string, string | string[] | undefined> | undefined;

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

function resolveGuildDisplayName(args: { guildId: string; guildName?: string }): string {
  const guildId = args.guildId.trim();
  if (!guildId) return "unknown-guild";
  const trimmed = args.guildName?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : guildId;
}

function resolveGuildIconUrl(guildIconUrl?: string): string | null {
  const trimmed = guildIconUrl?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function buildCampaignDescription(guildDisplayName: string): string {
  return `Canonical archive stream for ${guildDisplayName}.`;
}

function normalizeGuildId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function readGuildIdDisambiguator(searchParams?: QueryInput): string | null {
  const raw = searchParams?.guild_id ?? searchParams?.guildId;
  if (Array.isArray(raw)) {
    return normalizeGuildId(raw[0] ?? null);
  }
  return normalizeGuildId(typeof raw === "string" ? raw : null);
}

function readGuildNameById(auth: Awaited<ReturnType<typeof resolveWebAuthContext>>, guildId: string): string | undefined {
  return auth.authorizedGuilds.find((guild) => guild.id === guildId)?.name;
}

function readGuildIconById(auth: Awaited<ReturnType<typeof resolveWebAuthContext>>, guildId: string): string | undefined {
  return auth.authorizedGuilds.find((guild) => guild.id === guildId)?.iconUrl;
}

function resolveGuildScopeForSlug(args: {
  auth: Awaited<ReturnType<typeof resolveWebAuthContext>>;
  campaignSlug: string;
  searchParams?: QueryInput;
}): { guildId: string; guildName?: string; guildIconUrl?: string } | null {
  const requestedGuildId = readGuildIdDisambiguator(args.searchParams);
  const campaignSlug = args.campaignSlug.trim();
  if (!campaignSlug) {
    throw new ScopeGuardError("Campaign is out of scope for the authorized guild set.");
  }

  if (requestedGuildId) {
    const inAuthorizedSet = args.auth.authorizedGuildIds.some((guildId) => guildId === requestedGuildId);
    if (!inAuthorizedSet) {
      throw new ScopeGuardError("Campaign is out of scope for the authorized guild set.");
    }

    if (!isCampaignSlugOwnedByGuild({ guildId: requestedGuildId, campaignSlug })) {
      return null;
    }

    return {
      guildId: requestedGuildId,
      guildName: readGuildNameById(args.auth, requestedGuildId),
      guildIconUrl: readGuildIconById(args.auth, requestedGuildId),
    };
  }

  const matches: Array<{ guildId: string; guildName?: string; guildIconUrl?: string }> = [];
  for (const guildId of args.auth.authorizedGuildIds) {
    if (!isCampaignSlugOwnedByGuild({ guildId, campaignSlug })) continue;
    matches.push({
      guildId,
      guildName: readGuildNameById(args.auth, guildId),
      guildIconUrl: readGuildIconById(args.auth, guildId),
    });
  }

  if (matches.length === 0) {
    return null;
  }

  if (matches.length > 1) {
    throw new WebDataError(
      "ambiguous_campaign_scope",
      409,
      `Campaign slug '${campaignSlug}' matches multiple authorized guilds. Provide guild_id to disambiguate.`
    );
  }

  return matches[0] ?? null;
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
        startedByUserId: row.started_by_id,
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
  guildIconUrl?: string;
  canWrite?: boolean;
}): Promise<{ campaigns: CampaignSummary[]; wordsRecorded: number }> {
  const guildDisplayName = resolveGuildDisplayName({ guildId: args.guildId, guildName: args.guildName });
  const guildIconUrl = resolveGuildIconUrl(args.guildIconUrl);
  const configState = getGuildConfigState(args.guildId);
  const configuredSlug = getGuildCampaignSlugDiagnostic(args.guildId).normalizedCampaignSlug;
  const showtimeCampaigns = listGuildCampaignRecords(args.guildId);

  const slugSet = new Set<string>();
  for (const campaign of showtimeCampaigns) {
    const slug = campaign.campaign_slug?.trim();
    if (!slug) continue;
    slugSet.add(slug);
  }

  if (configuredSlug) {
    slugSet.add(configuredSlug);
  }

  const campaigns: CampaignSummary[] = [];
  let wordsRecorded = 0;

  for (const campaignSlug of slugSet) {
    const sessions = await listWebSessionsForCampaign({
      guildId: args.guildId,
      campaignSlug,
      limit: 50,
    });

    const campaignName = getGuildCampaignDisplayName({ guildId: args.guildId, campaignSlug })
      ?? prettifyCampaignSlug(campaignSlug);

    campaigns.push({
      slug: campaignSlug,
      guildId: args.guildId,
      name: campaignName,
      guildName: guildDisplayName,
      guildIconUrl,
      isDm: args.canWrite ?? false,
      description: buildCampaignDescription(guildDisplayName),
      sessionCount: sessions.length,
      lastSessionDate: sessions[0]?.session.date ?? null,
      sessions: sessions.map((entry) => entry.session),
      type: "user",
      editable: true,
      persisted: true,
      canWrite: args.canWrite ?? false,
    });

    wordsRecorded += sessions.reduce((sum, entry) => sum + entry.wordCount, 0);
  }

  return { campaigns, wordsRecorded };
}

export async function listWebCampaignsForGuilds(args: {
  authorizedGuildIds: string[];
  authorizedGuilds?: WebAuthorizedGuild[];
  authorizedUserId?: string | null;
  canWriteByGuildId?: Map<string, boolean>;
  includeDemoFallback?: boolean;
}): Promise<{ campaigns: CampaignSummary[]; wordsRecorded: number }> {
  const guildNameMap = new Map<string, string>();
  const guildIconMap = new Map<string, string>();
  for (const guild of args.authorizedGuilds ?? []) {
    const id = guild.id.trim();
    if (!id) continue;
    if (guild.name?.trim()) {
      guildNameMap.set(id, guild.name);
    }
    if (guild.iconUrl?.trim()) {
      guildIconMap.set(id, guild.iconUrl);
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
        guildIconUrl: guildIconMap.get(guildId),
        canWrite:
          args.canWriteByGuildId?.get(guildId)
          ?? canUserWriteGuildArchive({ guildId, userId: args.authorizedUserId ?? null }),
      })
    )
  );

  const campaigns: CampaignSummary[] = [];
  let wordsRecorded = 0;
  for (const item of results) {
    campaigns.push(...item.campaigns);
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
      return {
        totalSessions: 0,
        campaignCount: 0,
        wordsRecorded: 0,
        campaigns: [],
        authState: "unsigned",
      };
    }
    throw error;
  }

  if (auth.authorizedGuildIds.length === 0) {
    return {
      totalSessions: 0,
      campaignCount: 0,
      wordsRecorded: 0,
      campaigns: [],
      authState: "signed_in_no_authorized_guilds",
    };
  }

  const guildStates = auth.authorizedGuildIds.map((guildId) => ({
    guildId,
    config: getGuildConfigState(guildId),
    showtimeCount: listGuildCampaignRecords(guildId).length,
  }));

  const hasMeepoInstalled = guildStates.some((state) => state.config.hasGuildConfig || state.showtimeCount > 0);
  if (!hasMeepoInstalled) {
    return {
      totalSessions: 0,
      campaignCount: 0,
      wordsRecorded: 0,
      campaigns: [],
      authState: "signed_in_no_meepo_installed",
    };
  }

  const model = await listWebCampaignsForGuilds({
    authorizedGuildIds: auth.authorizedGuildIds,
    authorizedGuilds: auth.authorizedGuilds,
    authorizedUserId: auth.user?.id ?? null,
    includeDemoFallback: false,
  });

  const totalSessions = model.campaigns.reduce((sum, campaign) => sum + campaign.sessionCount, 0);

  if (totalSessions === 0) {
    return {
      totalSessions: 0,
      campaignCount: model.campaigns.length,
      wordsRecorded: model.wordsRecorded,
      campaigns: model.campaigns,
      authState: "signed_in_no_sessions",
    };
  }

  return {
    totalSessions,
    campaignCount: model.campaigns.length,
    wordsRecorded: model.wordsRecorded,
    campaigns: model.campaigns,
    authState: "ok",
  };
}

export async function getWebCampaignDetail(args: {
  campaignSlug: string;
  searchParams?: QueryInput;
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

  const resolvedScope = resolveGuildScopeForSlug({
    auth,
    campaignSlug: args.campaignSlug,
    searchParams: args.searchParams,
  });

  if (!resolvedScope) {
    return null;
  }

  const guildId = resolvedScope.guildId;
  const sessions = await listWebSessionsForCampaign({
    guildId,
    campaignSlug: args.campaignSlug,
    limit: 50,
  });
  const guildDisplayName = resolveGuildDisplayName({ guildId, guildName: resolvedScope.guildName });
  const guildIconUrl = resolveGuildIconUrl(resolvedScope.guildIconUrl);

  return {
    slug: args.campaignSlug,
    guildId,
    name: getGuildCampaignDisplayName({ guildId, campaignSlug: args.campaignSlug })
      ?? prettifyCampaignSlug(args.campaignSlug),
    guildName: guildDisplayName,
    guildIconUrl,
    isDm: canUserWriteGuildArchive({ guildId, userId: auth.user?.id ?? null }),
    description: buildCampaignDescription(guildDisplayName),
    sessionCount: sessions.length,
    lastSessionDate: sessions[0]?.session.date ?? null,
    sessions: sessions.map((entry) => entry.session),
    type: "user",
    editable: true,
    persisted: true,
    canWrite: canUserWriteGuildArchive({ guildId, userId: auth.user?.id ?? null }),
  };
}

export async function updateWebCampaignName(args: {
  campaignSlug: string;
  campaignName: string;
  searchParams?: QueryInput;
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

  const resolvedScope = resolveGuildScopeForSlug({
    auth,
    campaignSlug,
    searchParams: args.searchParams,
  });
  const ownerGuildId = resolvedScope?.guildId ?? null;

  // Upsert is allowed only after proving campaign slug ownership in authorized guild scope.
  if (!ownerGuildId) {
    throw new ScopeGuardError("Campaign is out of scope for the authorized guild set.");
  }

  assertUserCanWriteGuildArchive({
    guildId: ownerGuildId,
    userId: auth.user?.id ?? null,
  });

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