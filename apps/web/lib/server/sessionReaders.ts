import { buildSessionDetail } from "@/lib/mappers/sessionMappers";
import { mapToWebDataError, WebDataError } from "@/lib/mappers/errorMappers";
import { assertOpenAiConfigured } from "@/lib/server/capabilityErrors";
import { resolveWebAuthContext, WebAuthError } from "@/lib/server/authContext";
import { listWebCampaignsForGuilds } from "@/lib/server/campaignReaders";
import { getDemoSessionDetail, isDemoSessionId } from "@/lib/server/demoCampaign";
import {
  findSessionByGuildAndId,
  getGuildCampaignSlug,
  readSessionRecap,
  readSessionTranscript,
  type ArchiveRecap,
  type ArchiveSessionRow,
  type ArchiveTranscript,
} from "@/lib/server/readData/archiveReadStore";
import { assertSessionGuildInAuthorizedScope, ScopeGuardError } from "@/lib/server/scopeGuards";
import type { SessionArtifactStatus, SessionDetail } from "@/lib/types";

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

async function resolveAuthorizedSessionOwnership(args: {
  authorizedGuildIds: string[];
  sessionId: string;
}): Promise<{ guildId: string; campaignSlug: string; session: ArchiveSessionRow }> {

  const guildIds = normalizeAuthorizedGuildIds(args.authorizedGuildIds);
  if (guildIds.length === 0) {
    throw new ScopeGuardError("Session is out of scope for the authorized guild set.");
  }

  for (const guildId of guildIds) {
    const campaignSlug = getGuildCampaignSlug(guildId);
    if (!campaignSlug) continue;

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

    return { guildId, campaignSlug, session };
  }

  throw new ScopeGuardError("Session is out of scope for the authorized guild set.");
}

export async function getCanonicalSessionDetail(args: {
  authorizedGuildIds: string[];
  sessionId: string;
}): Promise<CanonicalSessionDetail> {
  const { guildId, campaignSlug, session } = await resolveAuthorizedSessionOwnership({
    authorizedGuildIds: args.authorizedGuildIds,
    sessionId: args.sessionId,
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
    const { guildId } = await resolveAuthorizedSessionOwnership({
      authorizedGuildIds: auth.authorizedGuildIds,
      sessionId: args.sessionId,
    });

    // Recap generation requires OpenAI at execution time; read paths remain independent.
    assertOpenAiConfigured();

    const { regenerateSessionRecap } = await import("../../../../src/sessions/sessionRecaps");
    await regenerateSessionRecap({
      guildId,
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
