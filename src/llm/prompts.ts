import type { MeepoInstance } from "../meepo/state.js";
import { getPersona } from "../personas/index.js";
import { getMeepoMemoriesSection } from "../ledger/meepo-mind.js";
import { log } from "../utils/logger.js";

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
}): Promise<BuildMeepoPromptResult> {
  const persona = getPersona(opts.personaId);
  llmLog.debug(`Using persona: ${persona.displayName} (${opts.personaId}), mindspace=${opts.mindspace ?? "none"}`);

  const customPersona = opts.meepo.persona_seed
    ? `\nAdditional character context:\n${opts.meepo.persona_seed}`
    : "";

  const voiceHint = opts.hasVoiceContext
    ? "\nRecent dialogue was spoken aloud in the room. Respond naturally, briefly, and as if replying in conversation.\n"
    : "";

  const isCampaign = persona.scope === "campaign";
  const partyMemory = isCampaign && opts.partyMemory
    ? `\n\n${opts.partyMemory}\n`
    : "";
  const convoTail = isCampaign && opts.convoTail
    ? `\n\n${opts.convoTail}`
    : "";

  const context = opts.recentContext
    ? `\n\nContext you may rely on:\n${opts.recentContext}`
    : "";

  const memory = persona.memory ? `\n${persona.memory}` : "";

  let meepoMemoriesSection = "";
  let memoryRefs: string[] = [];
  if (opts.mindspace) {
    const result = await getMeepoMemoriesSection({
      mindspace: opts.mindspace,
      includeLegacy: isCampaign,
      personaId: opts.personaId,
    });
    meepoMemoriesSection = result.section;
    memoryRefs = result.memoryRefs;
  }

  const styleGuard = persona.styleGuard || "";
  if (!persona.styleGuard) {
    console.warn(`Warning: Persona ${opts.personaId} missing styleGuard`);
  }

  const systemPrompt =
    persona.systemGuardrails +
    "\n" +
    persona.identity +
    memory +
    meepoMemoriesSection +
    partyMemory +
    convoTail +
    "\n" +
    persona.speechStyle +
    "\n" +
    persona.personalityTone +
    "\n" +
    styleGuard +
    voiceHint +
    customPersona +
    context;

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
