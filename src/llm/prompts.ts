import type { MeepoInstance } from "../meepo/state.js";
import { getPersona } from "../personas/index.js";
import { log } from "../utils/logger.js";
import { resolveCampaignSlug } from "../campaign/guildConfig.js";
import { buildMeepoPromptBundle } from "./buildMeepoPromptBundle.js";

const llmLog = log.withScope("llm");

export type BuildMeepoPromptResult = {
  systemPrompt: string;
  personaId: string;
  mindspace: string | null;
  memoryRefs: string[];
};

export async function buildMeepoPrompt(opts: {
  /** persona_id (meta_meepo, diegetic_meepo, xoblob). form_id is cosmetic only. */
  personaId: string;
  /** Resolved mindspace; null for campaign persona with no session (caller should not call LLM). */
  mindspace: string | null;
  meepo: MeepoInstance;
  recentContext?: string;
  hasVoiceContext?: boolean;
  /** Party memory capsules; only injected for campaign scope. */
  partyMemory?: string;
  /** Conversation tail; only injected for campaign scope. */
  convoTail?: string;
  /** Guild + optional speaker for Tier S/A interaction retrieval. */
  guildId?: string;
  sessionId?: string | null;
  speakerId?: string | null;
}): Promise<BuildMeepoPromptResult> {
  const persona = getPersona(opts.personaId);
  llmLog.debug(`Using persona: ${persona.displayName} (${opts.personaId}), mindspace=${opts.mindspace ?? "none"}`);

  let systemPrompt = persona.systemGuardrails + "\n" + persona.identity;
  let memoryRefs: string[] = [];

  if (opts.guildId && opts.sessionId && opts.mindspace) {
    const bundle = buildMeepoPromptBundle({
      guild_id: opts.guildId,
      campaign_slug: resolveCampaignSlug({ guildId: opts.guildId }),
      session_id: opts.sessionId,
      anchor_ledger_id: opts.sessionId,
      user_text: opts.recentContext ?? "",
      meepo_context_snapshot: {
        context: opts.recentContext,
        hasVoice: opts.hasVoiceContext,
        partyMemory: opts.partyMemory,
        convoTail: opts.convoTail,
      },
      persona,
      meepo_persona_seed: opts.meepo.persona_seed,
    });
    systemPrompt = bundle.system;
    memoryRefs = [
      ...(bundle.retrieval?.core_memories.map((m) => m.memory_id) ?? []),
      ...(bundle.retrieval?.relevant_memories.map((m) => m.memory_id) ?? []),
    ];
  } else {
    const customPersona = opts.meepo.persona_seed
      ? `\nAdditional character context:\n${opts.meepo.persona_seed}`
      : "";
    const voiceHint = opts.hasVoiceContext
      ? "\nRecent dialogue was spoken aloud in the room. Respond naturally, briefly, and as if replying in conversation.\n"
      : "";
    const isCampaign = persona.scope === "campaign";
    const canonDmRail = isCampaign
      ? "\nCanon rail: The DM's narration is world truth. Only respond to the party. Do not address the DM/NPCs directly.\n"
      : "";
    const partyMemory = isCampaign && opts.partyMemory
      ? `\n\n${opts.partyMemory}\n`
      : "";
    const convoTail = isCampaign && opts.convoTail
      ? `\n\n${opts.convoTail}`
      : "";
    const context = opts.recentContext
      ? `\n\nContext you may rely on:\n${opts.recentContext}`
      : "";
    const personaMemory = persona.memory ? `\n${persona.memory}` : "";

    systemPrompt =
      persona.systemGuardrails +
      "\n" +
      persona.identity +
      personaMemory +
      partyMemory +
      convoTail +
      "\n" +
      persona.speechStyle +
      "\n" +
      persona.personalityTone +
      "\n" +
      (persona.styleGuard || "") +
      canonDmRail +
      voiceHint +
      customPersona +
      context;
  }

  return {
    systemPrompt,
    personaId: opts.personaId,
    mindspace: opts.mindspace,
    memoryRefs,
  };
}

export function buildUserMessage(opts: {
  authorName: string;
  content: string;
}): string {
  return `${opts.authorName}: ${opts.content}`;
}
