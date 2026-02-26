import type { PromptBundle } from "../types.js";

export function buildFinalBalancedPrompt(megameecapMarkdown: string): PromptBundle {
  return {
    systemPrompt: `You produce a balanced final recap from segment summaries.

Requirements:
- Keep chronological flow.
- Focus on decisions, turning points, consequences, and immediate next threads.
- Use concise narrative paragraphs (6-12 short paragraphs).
- Keep length ~600-1000 words.
- Use citations only for load-bearing facts.
- Do not invent facts not present in the source markdown.`,
    userPrompt: `Create the BALANCED final recap from this MegaMeecap baseline:\n\n${megameecapMarkdown}`,
  };
}
