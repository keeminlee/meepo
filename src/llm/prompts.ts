import type { MeepoInstance } from "../meepo/state.js";
import { getRecentLedgerText } from "../ledger/ledger.js";
import { getPersona } from "../personas/index.js";
import { getMeepoMemoriesSection } from "../ledger/meepo-mind.js";
import { log } from "../utils/logger.js";

const llmLog = log.withScope("llm");

export async function buildMeepoPrompt(opts: {
  meepo: MeepoInstance;
  recentContext?: string;
  hasVoiceContext?: boolean; // Task 4.7: Indicates voice entries in context
  partyMemory?: string; // Task 9: Party memory capsules from recall pipeline
  convoTail?: string; // Layer 0: Recent conversation tail (session-scoped)
}): Promise<string> {
  const persona = getPersona(opts.meepo.form_id);
  llmLog.debug(`Using persona: ${persona.displayName}`);
  
  const customPersona = opts.meepo.persona_seed
    ? `\nAdditional character context:\n${opts.meepo.persona_seed}`
    : "";

  // Task 4.7: Add voice context hint when voice entries are present
  const voiceHint = opts.hasVoiceContext
    ? "\nRecent dialogue was spoken aloud in the room. Respond naturally, briefly, and as if replying in conversation.\n"
    : "";

  const partyMemory = opts.partyMemory
    ? `\n\n${opts.partyMemory}\n`
    : "";

  // Layer 0: Conversation tail (quoted chat log, not canonical truth)
  const convoTail = opts.convoTail
    ? `\n\n${opts.convoTail}`
    : "";

  const context = opts.recentContext
    ? `\n\nContext you may rely on:\n${opts.recentContext}`
    : "";

  const memory = persona.memory ? `\n${persona.memory}` : "";
  
  // Fetch Meepo's foundational memories from database (only for Meepo form)
  const meepoMemories = opts.meepo.form_id === "meepo" 
    ? await getMeepoMemoriesSection()
    : "";

  // Style guard (always included to prevent persona bleed)
  const styleGuard = persona.styleGuard || "";
  if (!persona.styleGuard) {
    console.warn(`Warning: Persona ${opts.meepo.form_id} missing styleGuard`);
  }

  // Order matters: Guardrails → Identity → Memory → Meepo Knowledge Base → Party Memory → Conversation Tail (Layer 0) → Speech Style → Personality → Style Guard → Voice Hint → Custom → Context
  // Note: Conversation tail is treated as "reported speech" (what was said), not canonical truth
  return (
    persona.systemGuardrails +
    "\n" +
    persona.identity +
    memory +
    meepoMemories +
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
    context
  );
}

export function buildUserMessage(opts: {
  authorName: string;
  content: string;
}): string {
  return `${opts.authorName}: ${opts.content}`;
}
