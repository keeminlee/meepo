import { createHash } from "node:crypto";
import { getDbForCampaign } from "../db.js";
import { appendMeepoActionLogEvent } from "../ledger/meepoActionLogging.js";
import { enqueueMeepoMindRetrieveIfNeeded } from "../ledger/meepoContextActions.js";
import {
  buildRetrievalArtifactPath,
  computeRetrievalQueryHash,
  loadRetrievalArtifact,
} from "../ledger/meepoMindRetrievalArtifacts.js";
import type {
  BuildMeepoPromptBundleInput,
  PromptBundle,
  RetrievalContext,
} from "./promptBundleTypes.js";

const DEFAULT_RETRIEVAL_TOP_K = 8;
const DEFAULT_RETRIEVAL_ALGO_VERSION = "v1.2.1";

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function formatRetrievalSection(ctx?: RetrievalContext): string {
  if (!ctx) return "";
  const lines: string[] = [];

  if (ctx.core_memories.length > 0) {
    lines.push("## Core Memories");
    for (const memory of ctx.core_memories) {
      lines.push(`- ${memory.title}: ${memory.text}`);
    }
    lines.push("");
  }

  if (ctx.relevant_memories.length > 0) {
    lines.push("## Relevant Memories");
    for (const memory of ctx.relevant_memories) {
      lines.push(`- (${memory.score.toFixed(3)}) ${memory.title}: ${memory.text}`);
    }
    lines.push("");
  }

  return lines.length > 0
    ? `\n\nMEEPO MIND RETRIEVAL CONTEXT:\n${lines.join("\n")}`
    : "";
}

function buildSystemPrompt(args: {
  input: BuildMeepoPromptBundleInput;
  retrievalSection: string;
}): string {
  const { input, retrievalSection } = args;
  const customPersona = input.meepo_persona_seed
    ? `\nAdditional character context:\n${input.meepo_persona_seed}`
    : "";
  const voiceHint = input.meepo_context_snapshot.hasVoice
    ? "\nRecent dialogue was spoken aloud in the room. Respond naturally, briefly, and as if replying in conversation.\n"
    : "";

  const isCampaign = input.persona.scope === "campaign";
  const canonDmRail = isCampaign
    ? "\nCanon rail: The DM's narration is world truth. Only respond to the party. Do not address the DM/NPCs directly.\n"
    : "";

  const partyMemory = isCampaign && input.meepo_context_snapshot.partyMemory
    ? `\n\n${input.meepo_context_snapshot.partyMemory}\n`
    : "";

  const convoTail = isCampaign && input.meepo_context_snapshot.convoTail
    ? `\n\n${input.meepo_context_snapshot.convoTail}`
    : "";

  const context = input.meepo_context_snapshot.context
    ? `\n\nContext you may rely on:\n${input.meepo_context_snapshot.context}`
    : "";

  const personaMemory = input.persona.memory ? `\n${input.persona.memory}` : "";

  return (
    input.persona.systemGuardrails +
    "\n" +
    input.persona.identity +
    personaMemory +
    retrievalSection +
    partyMemory +
    convoTail +
    "\n" +
    input.persona.speechStyle +
    "\n" +
    input.persona.personalityTone +
    "\n" +
    (input.persona.styleGuard || "") +
    canonDmRail +
    voiceHint +
    customPersona +
    context
  );
}

export function buildMeepoPromptBundle(input: BuildMeepoPromptBundleInput): PromptBundle {
  const startedAtMs = Date.now();
  const topK = Math.max(0, Math.trunc(input.retrieval?.top_k ?? DEFAULT_RETRIEVAL_TOP_K));
  const algoVersion = (input.retrieval?.algo_version?.trim() || DEFAULT_RETRIEVAL_ALGO_VERSION);
  const queryHash = computeRetrievalQueryHash(input.user_text);

  const retrievalEligible = input.persona.scope === "campaign" && input.session_id !== "__ambient__";
  const artifactPath = retrievalEligible
    ? buildRetrievalArtifactPath({
        campaignSlug: input.campaign_slug,
        sessionId: input.session_id,
        anchorLedgerId: input.anchor_ledger_id,
        algoVersion,
        topK,
        queryHash,
      })
    : null;

  const db = getDbForCampaign(input.campaign_slug);
  const artifact = artifactPath ? loadRetrievalArtifact({ artifactPath }) : null;

  let retrieval: RetrievalContext | undefined;
  if (artifact) {
    retrieval = {
      core_memories: artifact.always.memories.map((memory) => ({
        memory_id: memory.memory_id,
        title: memory.title,
        text: memory.text,
      })),
      relevant_memories: artifact.ranked.memories.map((memory) => ({
        memory_id: memory.memory_id,
        title: memory.title,
        text: memory.text,
        score: memory.score,
      })),
    };

    appendMeepoActionLogEvent(db, {
      ts_ms: Date.now(),
      run_kind: "online",
      guild_id: input.guild_id,
      scope: "canon",
      session_id: input.session_id,
      event_type: "RETRIEVAL_REUSED",
      anchor_ledger_id: input.anchor_ledger_id,
      action_type: "meepo-mind-retrieve",
      algo_version: artifact.algo_version,
      query_hash: artifact.query_hash,
      top_k: artifact.top_k,
      artifact_path: artifactPath ?? undefined,
      always_count: artifact.stats.always_count,
      ranked_count: artifact.stats.ranked_count,
      db_ms: artifact.stats.db_ms,
      status: "skipped",
    });
  } else if (retrievalEligible) {
    enqueueMeepoMindRetrieveIfNeeded(db, {
      guildId: input.guild_id,
      campaignSlug: input.campaign_slug,
      scope: "canon",
      sessionId: input.session_id,
      anchorLedgerId: input.anchor_ledger_id,
      queryText: input.user_text,
      queryHash,
      topK,
      algoVersion,
      nowMs: Date.now(),
      runKind: "online",
    });
  }

  const retrievalSection = formatRetrievalSection(retrieval);
  const system = buildSystemPrompt({ input, retrievalSection });

  const bundle: PromptBundle = {
    system,
    messages: [
      {
        role: "user",
        content: input.user_text,
      },
    ],
    retrieval,
    metadata: {
      campaign_slug: input.campaign_slug,
      session_id: input.session_id,
      anchor_ledger_id: input.anchor_ledger_id,
    },
    debug: {
      context_hash: stableHash({
        context: input.meepo_context_snapshot,
        persona: input.persona.id,
        system,
      }),
      retrieval_hash: retrieval ? stableHash(retrieval) : undefined,
    },
  };

  appendMeepoActionLogEvent(db, {
    ts_ms: Date.now(),
    run_kind: "online",
    guild_id: input.guild_id,
    scope: "canon",
    campaign_slug: input.campaign_slug,
    session_id: input.session_id,
    anchor_ledger_id: input.anchor_ledger_id,
    event: "prompt-bundle-built",
    data: {
      bundle_hash: stableHash({
        system: bundle.system,
        messages: bundle.messages,
        retrieval: bundle.retrieval,
      }),
      has_retrieval: Boolean(bundle.retrieval),
      retrieval_artifact_relpath: artifactPath ?? undefined,
      retrieval_always_count: artifact?.stats.always_count,
      retrieval_ranked_count: artifact?.stats.ranked_count,
      rails_version: input.persona.styleSpec?.name,
      build_ms: Date.now() - startedAtMs,
      estimated_tokens: Math.ceil((bundle.system.length + input.user_text.length) / 4),
      message_count: bundle.messages.length,
    },
  });

  return bundle;
}
