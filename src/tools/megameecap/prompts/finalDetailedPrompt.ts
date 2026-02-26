import type { PromptBundle } from "../types.js";

export function buildFinalDetailedPrompt(megameecapMarkdown: string): PromptBundle {
  return {
    systemPrompt: `You produce a detailed final recap from segment summaries.

Requirements:
- Preserve scene order.
- Include key reveals, decisions, consequences, and unresolved hooks.
- Prefer narrative prose with light structure.
- Keep length ~1200-2000 words.
- Light citations are allowed for load-bearing claims.
- Do not invent facts not present in the source markdown.`,
    userPrompt: `Create the DETAILED final recap from this MegaMeecap baseline:\n\n${megameecapMarkdown}`,
  };
}
