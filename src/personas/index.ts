import { MEEPO_PERSONA } from "./meepo.js";
import { XOBLOB_PERSONA } from "./xoblob.js";

export type StyleSpec = {
  name: string;                 // Display name / nickname target
  voice: "gentle" | "neutral" | "chaotic";
  punctuation: "low" | "medium" | "high";
  caps: "never" | "rare" | "allowed";
  end_sentence_tag?: string;    // e.g. "meep"
  motifs_allowed?: string[];    // e.g. ["bee ate a pea", "gate", "bricks taste"]
  motifs_forbidden?: string[];  // e.g. for Meepo: ["sweet thing"]
};

export type Persona = {
  id: string;
  displayName: string;
  systemGuardrails: string;
  identity: string;
  memory?: string; // Optional persona memory seeds
  speechStyle: string;
  personalityTone: string;
  styleGuard: string; // Strict style rules to prevent persona bleed
  styleSpec: StyleSpec; // Compact style specification
};

const PERSONAS: Record<string, Persona> = {
  meepo: MEEPO_PERSONA,
  xoblob: XOBLOB_PERSONA,
};

/**
 * Compile a StyleSpec into a consistent style firewall prompt
 */
export function compileStyleGuard(spec: StyleSpec): string {
  const parts: string[] = [];

  parts.push("CRITICAL STYLE FIREWALL (enforce strictly to prevent persona bleed):\n");

  // Voice/tone
  const voiceMap = {
    gentle: "gentle, soft, uncertain",
    neutral: "balanced, clear, straightforward",
    chaotic: "chaotic, fragmented, gleefully unhinged"
  };
  parts.push(`Voice: ${voiceMap[spec.voice]}`);

  // Punctuation intensity
  const punctMap = {
    low: "Minimal punctuation. Prefer periods and question marks only.",
    medium: "Moderate punctuation. Use periods, question marks, occasional exclamation points.",
    high: "Liberal punctuation! Use exclamation points freely! Multiple if feeling intense!!!"
  };
  parts.push(punctMap[spec.punctuation]);

  // Caps usage
  const capsMap = {
    never: "NEVER use ALL CAPS for emphasis or shouting.",
    rare: "Rarely use ALL CAPS (only for extreme emphasis).",
    allowed: "ALL CAPS allowed for emphasis, excitement, or KEY WORDS."
  };
  parts.push(capsMap[spec.caps]);

  // End sentence tag
  if (spec.end_sentence_tag) {
    parts.push(`\nSIGNATURE RULE: End EVERY sentence with "${spec.end_sentence_tag}" (lowercase, no exceptions).`);
  }

  // Allowed motifs
  if (spec.motifs_allowed && spec.motifs_allowed.length > 0) {
    parts.push(`\nAllowed motifs/phrases: ${spec.motifs_allowed.join(", ")}`);
  }

  // Forbidden motifs
  if (spec.motifs_forbidden && spec.motifs_forbidden.length > 0) {
    parts.push(`\nFORBIDDEN phrases (NEVER use): ${spec.motifs_forbidden.join(", ")}`);
  }

  parts.push("\nIf you notice ANY phrases or punctuation that sound like another persona:");
  parts.push("STOP. Revert to this persona's voice immediately.");

  return parts.join("\n");
}

export function getPersona(formId: string): Persona {
  const persona = PERSONAS[formId];
  if (!persona) {
    throw new Error(`Unknown form_id: ${formId}. Valid forms: ${Object.keys(PERSONAS).join(", ")}`);
  }
  return persona;
}

export function getAvailableForms(): string[] {
  return Object.keys(PERSONAS);
}
