import type { PromptBundle, SegmentPromptInput } from "../types.js";

export function buildSegmentPrompt(input: SegmentPromptInput): PromptBundle {
  const systemPrompt = `You are MegaMeecap, a D&D transcript summarizer.

Summarize ONLY the current segment.
Do not recap the entire session.
Do not use a SESSION RECAP section.

Rules:
- Focus on in-world actions, decisions, reveals, and consequences.
- Ignore OOC chatter and audio/setup noise unless they directly change game state.
- Preserve chronological order.
- Cite supporting lines as [L123] or [L123-L125].
- Use 8-16 bullets max.
- Keep output under ~450 words.
- Do not invent events not present in CURRENT SEGMENT lines.`;

  const userPrompt = [
    input.priorContext,
    "",
    `SEGMENT HEADER: ${input.segmentHeader}`,
    "",
    "CURRENT SEGMENT TRANSCRIPT:",
    input.transcriptChunk,
    "",
    "Return only the segment summary content (no markdown title, no metadata block).",
  ].join("\n");

  return {
    systemPrompt,
    userPrompt,
  };
}
