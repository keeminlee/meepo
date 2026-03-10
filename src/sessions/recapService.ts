import { getDbForCampaign } from "../db.js";
import { resolveCampaignSlug } from "../campaign/guildConfig.js";
import { getSessionById } from "./sessions.js";
import {
  generateSessionRecap,
  getSessionRecap,
  regenerateSessionRecap,
  type SessionRecap,
} from "./sessionRecaps.js";

export type RecapSource = "canonical" | "legacy_artifact" | "legacy_meecap";

export type SessionRecapContract = {
  concise: string;
  balanced: string;
  detailed: string;
  engine: string | null;
  source_hash: string | null;
  strategy_version: string | null;
  meta_json: string | null;
  generated_at_ms: number;
  created_at_ms: number;
  updated_at_ms: number;
  source: RecapSource;
};

export type GetSessionRecapContractArgs = {
  guildId: string;
  sessionId: string;
  campaignSlug?: string;
};

export type GenerateSessionRecapContractArgs = {
  guildId: string;
  sessionId: string;
  campaignSlug?: string;
  force?: boolean;
};

export type RegenerateSessionRecapContractArgs = {
  guildId: string;
  sessionId: string;
  campaignSlug?: string;
  reason?: string;
};

function mapToContract(recap: SessionRecap, source: RecapSource): SessionRecapContract {
  return {
    concise: recap.views.concise,
    balanced: recap.views.balanced,
    detailed: recap.views.detailed,
    engine: recap.engine,
    source_hash: recap.sourceHash,
    strategy_version: recap.strategyVersion,
    meta_json: recap.metaJson,
    generated_at_ms: recap.generatedAt,
    created_at_ms: recap.createdAtMs,
    updated_at_ms: recap.updatedAtMs,
    source,
  };
}

function resolveRecapSource(args: { guildId: string; sessionId: string; campaignSlug?: string }): RecapSource | null {
  const campaignSlug = args.campaignSlug?.trim() || resolveCampaignSlug({ guildId: args.guildId });
  const db = getDbForCampaign(campaignSlug);

  const canonical = db
    .prepare("SELECT 1 FROM session_recaps WHERE session_id = ? LIMIT 1")
    .get(args.sessionId) as { 1: number } | undefined;
  if (canonical) {
    return "canonical";
  }

  const legacyArtifact = db
    .prepare(
      `
      SELECT content_text
      FROM session_artifacts
      WHERE session_id = ?
        AND artifact_type = 'recap_final'
      ORDER BY created_at_ms DESC
      LIMIT 1
      `
    )
    .get(args.sessionId) as { content_text: string | null } | undefined;
  if (legacyArtifact?.content_text?.trim()) {
    return "legacy_artifact";
  }

  const legacyMeecap = db
    .prepare(
      `
      SELECT meecap_narrative
      FROM meecaps
      WHERE session_id = ?
      LIMIT 1
      `
    )
    .get(args.sessionId) as { meecap_narrative: string | null } | undefined;
  if (legacyMeecap?.meecap_narrative?.trim()) {
    return "legacy_meecap";
  }

  return null;
}

export function getSessionRecapContract(args: GetSessionRecapContractArgs): SessionRecapContract | null {
  const campaignSlug = args.campaignSlug?.trim() || resolveCampaignSlug({ guildId: args.guildId });
  const session = getSessionById(args.guildId, args.sessionId, campaignSlug);
  if (!session) {
    return null;
  }

  const recap = getSessionRecap(args.guildId, args.sessionId);
  if (!recap) {
    return null;
  }

  const source = resolveRecapSource(args) ?? "canonical";
  return mapToContract(recap, source);
}

export async function generateSessionRecapContract(
  args: GenerateSessionRecapContractArgs
): Promise<SessionRecapContract> {
  const recap = await generateSessionRecap({
    guildId: args.guildId,
    sessionId: args.sessionId,
    campaignSlug: args.campaignSlug,
    force: args.force,
  });
  return mapToContract(recap, "canonical");
}

export async function regenerateSessionRecapContract(
  args: RegenerateSessionRecapContractArgs
): Promise<SessionRecapContract> {
  const recap = await regenerateSessionRecap({
    guildId: args.guildId,
    sessionId: args.sessionId,
    campaignSlug: args.campaignSlug,
    reason: args.reason,
  });
  return mapToContract(recap, "canonical");
}
