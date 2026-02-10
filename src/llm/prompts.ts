import type { MeepoInstance } from "../meepo/state.js";
import { getRecentLedgerText } from "../ledger/ledger.js";
import { getPersona } from "../personas/index.js";

export function buildMeepoPrompt(opts: {
  meepo: MeepoInstance;
  recentContext?: string;
}): string {
  const persona = getPersona(opts.meepo.form_id);
  console.log("Using persona:", persona.displayName, `(${opts.meepo.form_id})`);
  
  const customPersona = opts.meepo.persona_seed
    ? `\nAdditional character context:\n${opts.meepo.persona_seed}`
    : "";

  const context = opts.recentContext
    ? `\n\nContext you may rely on:\n${opts.recentContext}`
    : "";

  const memory = persona.memory ? `\n${persona.memory}` : "";

  // Style guard (always included to prevent persona bleed)
  const styleGuard = persona.styleGuard || "";
  if (!persona.styleGuard) {
    console.warn(`Warning: Persona ${opts.meepo.form_id} missing styleGuard`);
  }

  // Order matters: Guardrails → Identity → Memory → Speech Style → Personality → Style Guard → Custom → Context
  return (
    persona.systemGuardrails +
    "\n" +
    persona.identity +
    memory +
    "\n" +
    persona.speechStyle +
    "\n" +
    persona.personalityTone +
    "\n" +
    styleGuard +
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
