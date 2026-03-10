import { buildSessionDetail } from "@/lib/mappers/sessionMappers";
import { mapToWebDataError, WebDataError } from "@/lib/mappers/errorMappers";
import { assertOpenAiConfigured } from "@/lib/server/capabilityErrors";
import { resolveWebAuthContext, WebAuthError } from "@/lib/server/authContext";
import { listWebCampaignsForGuilds } from "@/lib/server/campaignReaders";
import { getDemoSessionDetail, isDemoSessionId } from "@/lib/server/demoCampaign";
import {
  findSessionByGuildAndId,
  getGuildCampaignSlug,
  listGuildCampaignRecords,
  readSessionRecap,
  readSessionTranscript,
  updateSessionLabel,
  type ArchiveRecap,
  type ArchiveSessionRow,
  type ArchiveTranscript,
} from "@/lib/server/readData/archiveReadStore";
import { assertSessionGuildInAuthorizedScope, ScopeGuardError } from "@/lib/server/scopeGuards";
import type { SessionArtifactStatus, SessionDetail } from "@/lib/types";
import { assertUserCanWriteCampaignArchive, canUserWriteCampaignArchive } from "@/lib/server/writeAuthority";

export type CanonicalSessionDetail = {
  guildId: string;
  campaignSlug: string;
  session: ArchiveSessionRow;
  transcript: ArchiveTranscript | null;
  recap: ArchiveRecap | null;
  transcriptStatus: SessionArtifactStatus;
  recapStatus: SessionArtifactStatus;
  warnings: string[];
};

function normalizeAuthorizedGuildIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function normalizeScopeToken(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function readScopeHint(
  searchParams: Record<string, string | string[] | undefined> | undefined,
  ...keys: string[]
): string | null {
  if (!searchParams) return null;
  for (const key of keys) {
    const value = searchParams[key];
    if (Array.isArray(value)) {
      const normalized = normalizeScopeToken(value[0]);
      if (normalized) return normalized;
      continue;
    }
    const normalized = normalizeScopeToken(value);
    if (normalized) return normalized;
  }
  return null;
}

type ResolvedSessionOwnership = {
  guildId: string;
  campaignSlug: string;
  session: ArchiveSessionRow;
};

async function resolveAuthorizedSessionOwnership(args: {
  authorizedGuildIds: string[];
  sessionId: string;
  searchParams?: Record<string, string | string[] | undefined>;
}): Promise<ResolvedSessionOwnership> {

  const guildIds = normalizeAuthorizedGuildIds(args.authorizedGuildIds);
  if (guildIds.length === 0) {
    throw new ScopeGuardError("Session is out of scope for the authorized guild set.");
  }

  const requestedGuildId = readScopeHint(args.searchParams, "guild_id", "guildId");
  const requestedCampaignSlug = readScopeHint(args.searchParams, "campaign_slug", "campaignSlug");

  if (requestedGuildId && !guildIds.includes(requestedGuildId)) {
    throw new ScopeGuardError("Session is out of scope for the authorized guild set.");
  }

  const guildIdsToScan = requestedGuildId ? [requestedGuildId] : guildIds;
  const matches: ResolvedSessionOwnership[] = [];

  for (const guildId of guildIdsToScan) {
    const campaignCandidates = new Set<string>();

    if (requestedCampaignSlug) {
      campaignCandidates.add(requestedCampaignSlug);
    } else {
      const configuredSlug = getGuildCampaignSlug(guildId);
      if (configuredSlug) {
        campaignCandidates.add(configuredSlug);
      }

      const records = listGuildCampaignRecords(guildId);
      for (const record of records) {
        const slug = record.campaign_slug?.trim();
        if (!slug) continue;
        campaignCandidates.add(slug);
      }
    }

    for (const campaignSlug of campaignCandidates) {
      const session = findSessionByGuildAndId({
        guildId,
        campaignSlug,
        sessionId: args.sessionId,
      });
      if (!session) continue;

      assertSessionGuildInAuthorizedScope({
        authorizedGuildIds: guildIds,
        sessionGuildId: session.guild_id,
      });

      matches.push({ guildId, campaignSlug, session });
    }
  }

  if (matches.length > 1) {
    throw new WebDataError(
      "ambiguous_session_scope",
      409,
      `Session '${args.sessionId}' matches multiple authorized scopes. Provide guild_id to disambiguate.`
    );
  }

  const resolved = matches[0];
  if (resolved) {
    return resolved;
  }

  throw new ScopeGuardError("Session is out of scope for the authorized guild set.");
}

export async function updateWebSessionLabel(args: {
  sessionId: string;
  label: string | null;
  searchParams?: Record<string, string | string[] | undefined>;
}): Promise<SessionDetail> {
  try {
    if (isDemoSessionId(args.sessionId)) {
      throw new WebDataError("invalid_request", 422, "Demo sessions do not support label editing.");
    }

    const auth = await resolveWebAuthContext(args.searchParams);
    const { guildId, campaignSlug } = await resolveAuthorizedSessionOwnership({
      authorizedGuildIds: auth.authorizedGuildIds,
      sessionId: args.sessionId,
      searchParams: args.searchParams,
    });

    assertUserCanWriteCampaignArchive({
      guildId,
      campaignSlug,
      userId: auth.user?.id ?? null,
    });

    const normalizedLabel = args.label === null ? null : args.label.trim();
    if (normalizedLabel !== null && normalizedLabel.length > 80) {
      throw new WebDataError("invalid_request", 422, "session label exceeds max length (80).");
    }

    // Canonical source-of-truth: mutate only sessions.label in the scoped campaign DB.
    const updated = updateSessionLabel({
      guildId,
      campaignSlug,
      sessionId: args.sessionId,
      label: normalizedLabel && normalizedLabel.length > 0 ? normalizedLabel : null,
    });

    if (!updated) {
      throw new ScopeGuardError("Session is out of scope for the authorized guild set.");
    }

    return getWebSessionDetail({
      sessionId: args.sessionId,
      searchParams: args.searchParams,
    });
  } catch (error) {
    throw mapToWebDataError(error);
  }
}

export async function getCanonicalSessionDetail(args: {
  authorizedGuildIds: string[];
  sessionId: string;
  searchParams?: Record<string, string | string[] | undefined>;
}): Promise<CanonicalSessionDetail> {
  const { guildId, campaignSlug, session } = await resolveAuthorizedSessionOwnership({
    authorizedGuildIds: args.authorizedGuildIds,
    sessionId: args.sessionId,
    searchParams: args.searchParams,
  });

  const warnings: string[] = [];
  let transcript = null as ArchiveTranscript | null;
  let recap: ArchiveRecap | null = null;
  let transcriptStatus: SessionArtifactStatus = "missing";
  let recapStatus: SessionArtifactStatus = "missing";

  try {
    transcript = readSessionTranscript({
      guildId,
      campaignSlug,
      sessionId: args.sessionId,
    });
    transcriptStatus = transcript && transcript.lineCount > 0 ? "available" : "missing";
  } catch (error) {
    const mapped = mapToWebDataError(error);
    transcriptStatus = mapped.code === "transcript_unavailable" ? "unavailable" : "missing";
    warnings.push(mapped.message);
  }

  try {
    recap = readSessionRecap({
      guildId,
      campaignSlug,
      sessionId: args.sessionId,
    });
    recapStatus = recap ? "available" : "missing";
  } catch (error) {
    const mapped = mapToWebDataError(error);
    recapStatus = mapped.code === "recap_unavailable" ? "unavailable" : "missing";
    warnings.push(mapped.message);
    recap = null;
  }

  return {
    guildId,
    campaignSlug,
    session,
    transcript,
    recap,
    transcriptStatus,
    recapStatus,
    warnings,
  };
}

export async function getWebSessionDetail(args: {
  sessionId: string;
  searchParams?: Record<string, string | string[] | undefined>;
}): Promise<SessionDetail> {
  try {
    const demoRequested = isDemoSessionId(args.sessionId);

    let auth = null as Awaited<ReturnType<typeof resolveWebAuthContext>> | null;
    try {
      auth = await resolveWebAuthContext(args.searchParams);
    } catch (error) {
      if (error instanceof WebAuthError && error.reason === "unsigned" && demoRequested) {
        const demoDetail = getDemoSessionDetail(args.sessionId);
        if (demoDetail) {
          return demoDetail;
        }
      }
      throw error;
    }

    if (demoRequested) {
      const campaigns = await listWebCampaignsForGuilds({
        authorizedGuildIds: auth.authorizedGuildIds,
        authorizedGuilds: auth.authorizedGuilds,
        includeDemoFallback: false,
      });

      if (campaigns.campaigns.some((campaign) => campaign.slug === "demo")) {
        const demoDetail = getDemoSessionDetail(args.sessionId);
        if (demoDetail) {
          return demoDetail;
        }
      }
    }

    const canonical = await getCanonicalSessionDetail({
      authorizedGuildIds: auth.authorizedGuildIds,
      sessionId: args.sessionId,
      searchParams: args.searchParams,
    });

    return buildSessionDetail({
      guildId: canonical.guildId,
      campaignSlug: canonical.campaignSlug,
      session: canonical.session,
      transcript: canonical.transcript,
      recap: canonical.recap,
      transcriptStatus: canonical.transcriptStatus,
      recapStatus: canonical.recapStatus,
      warnings: canonical.warnings,
      canWrite: canUserWriteCampaignArchive({
        guildId: canonical.guildId,
        campaignSlug: canonical.campaignSlug,
        userId: auth.user?.id ?? null,
      }),
    });
  } catch (error) {
    throw mapToWebDataError(error);
  }
}

export async function regenerateWebSessionRecap(args: {
  sessionId: string;
  reason?: string;
  searchParams?: Record<string, string | string[] | undefined>;
}): Promise<SessionDetail> {
  try {
    if (isDemoSessionId(args.sessionId)) {
      throw new WebDataError("invalid_request", 422, "Demo sessions do not support recap regeneration.");
    }

    const auth = await resolveWebAuthContext(args.searchParams);
    const { guildId, campaignSlug } = await resolveAuthorizedSessionOwnership({
      authorizedGuildIds: auth.authorizedGuildIds,
      sessionId: args.sessionId,
      searchParams: args.searchParams,
    });

    assertUserCanWriteCampaignArchive({
      guildId,
      campaignSlug,
      userId: auth.user?.id ?? null,
    });

    // Recap generation requires OpenAI at execution time; read paths remain independent.
    assertOpenAiConfigured();

    const { regenerateSessionRecap } = await import("../../../../src/sessions/sessionRecaps");
    await regenerateSessionRecap({
      guildId,
      campaignSlug,
      sessionId: args.sessionId,
      reason: args.reason,
    });

    return getWebSessionDetail({
      sessionId: args.sessionId,
      searchParams: args.searchParams,
    });
  } catch (error) {
    throw mapToWebDataError(error);
  }
}
