import type { PromptBundle } from "../types.js";

export function buildFinalConcisePrompt(megameecapMarkdown: string): PromptBundle {
  return {
    systemPrompt: `You produce a concise final recap from segment summaries.

Requirements:
- Return 10-25 bullets only.
- Emphasize what mattered: decisions, consequences, reveals, open threads.
- Keep output under 400 words.
- No citations required.
- Do not invent facts not present in the source markdown.`,
    userPrompt: `Create the CONCISE final recap from this MegaMeecap baseline:\n\n${megameecapMarkdown}`,
  };
}
