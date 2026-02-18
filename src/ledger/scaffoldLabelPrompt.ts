/**
 * scaffoldLabelPrompt.ts
 *
 * Build prompts for batch LLM event labeling.
 *
 * Input: Pre-segmented scaffold spans with excerpts
 * Output: JSON array of labels (title, type, is_ooc, participants)
 *
 * Strategy:
 * - System: strict JSON-only instructions, no boundaries
 * - User: batch metadata + excerpts + allowed enums
 * - Output: array of label objects, keyed by event_id
 */

import type { EventScaffoldBatch, LabeledEvent, ALLOWED_EVENT_TYPES } from "./scaffoldBatchTypes.js";

export interface PromptOptions {
  /** Known character/participant names (for constraint if provided). Optional. */
  knownParticipants?: string[];

  /** Include token budget warning in output. Default: true */
  includeTokenWarning?: boolean;
}

export interface PromptOutput {
  system: string;
  user: string;
}

/**
 * Build system prompt (strict, immutable).
 */
function buildSystemPrompt(): string {
  return `You are a D&D session event labeler. You label pre-segmented transcript spans.

CRITICAL RULES:
1. Do NOT change or suggest different boundaries.
2. Do NOT add narrative or explanation.
3. Return ONLY a JSON array, nothing else.
4. Each item MUST have these exact keys: event_id, title, event_type, is_ooc
5. event_type must be one of the allowed values.
6. is_ooc must be a boolean (true = out-of-character, false = in-character gameplay).
7. title should be brief (1–10 words, max 200 chars).
8. If uncertain, prefer event_type "unknown" — do not guess.
9. Participants are optional; if included, use exact names from excerpt.`;
}

/**
 * Build user prompt with batch metadata and excerpts.
 */
function buildUserPrompt(
  batch: EventScaffoldBatch,
  opts: PromptOptions = {}
): string {
  const allowedTypes = [
    "action",
    "dialogue",
    "discovery",
    "emotional",
    "conflict",
    "plan",
    "transition",
    "recap",
    "ooc_logistics",
  ];

  // Build batch items JSON (with excerpts)
  const batchItemsJson = JSON.stringify(
    batch.items.map((item) => ({
      event_id: item.event_id,
      start_index: item.start_index,
      end_index: item.end_index,
      boundary_reason: item.boundary_reason,
      dm_ratio: item.dm_ratio,
      excerpt: item.excerpt,
    })),
    null,
    2
  );

  let participantStatement = "";
  if (opts.knownParticipants && opts.knownParticipants.length > 0) {
    participantStatement = `\n\nKnown participants in this session: ${opts.knownParticipants.join(", ")}\nIf participants are extracted from the excerpt, use these names or close matches.`;
  }

  return `Label these ${batch.items.length} pre-segmented D&D session spans.

Session: ${batch.session_label || "unknown"}
Batch: ${batch.batch_id} (${batch.items.length} events)

EVENT DEFINITIONS:
- "action": combat, movement, physical task (rolling checks, using abilities)
- "dialogue": conversation between characters
- "discovery": finding info, revealing secrets, plot exposition
- "emotional": character emotions, reactions, relationships (non-dialogue focus)
- "conflict": disagreement, betrayal, tension between PCs or with NPCs
- "plan": strategy discussion, coordinating next steps, preparation
- "transition": scene changes, narration, travel, "meanwhile..."
- "recap": session summary, player memory triggers, recap narration
- "ooc_logistics": rules clarifications, scheduling, tech issues, breaks${participantStatement}

ALLOWED event_types:
${allowedTypes.map((t) => `  - "${t}"`).join("\n")}

BATCH ITEMS (with excerpts):
${batchItemsJson}

Return a JSON array with exactly ${batch.items.length} objects.
Each object: { "event_id": "...", "title": "...", "event_type": "...", "is_ooc": true|false }

Example output format:
[
  { "event_id": "E0001", "title": "Opening remarks", "event_type": "recap", "is_ooc": false },
  { "event_id": "E0002", "title": "Party enters tavern", "event_type": "transition", "is_ooc": false }
]

Return ONLY the JSON array. No markdown, no explanation.`;
}

/**
 * Build complete prompt for batch labeling.
 *
 * @param batch - Batch with populated excerpts
 * @param opts - Configuration
 * @returns Object with system + user prompts
 */
export function buildLabelPrompt(
  batch: EventScaffoldBatch,
  opts: PromptOptions = {}
): PromptOutput {
  const system = buildSystemPrompt();
  const user = buildUserPrompt(batch, opts);

  return { system, user };
}

/**
 * Estimate token count for prompt (rough heuristic).
 * Used to warn if batch might exceed budget.
 *
 * @param system - System prompt
 * @param user - User prompt
 * @returns Estimated token count
 */
export function estimatePromptTokens(system: string, user: string): number {
  // Rough: ~4 chars per token (GPT-style)
  const systemTokens = Math.ceil(system.length / 4);
  const userTokens = Math.ceil(user.length / 4);
  const overhead = 200; // Buffer for JSON parsing + response overhead

  return systemTokens + userTokens + overhead;
}

/**
 * Validate prompt doesn't exceed reasonable token budget for batch.
 * Returns warning if too large.
 *
 * @param batch - Batch with excerpts
 * @param opts - Configuration
 * @param maxTokens - Hard token limit. Default: 14000 (leaves 2K for response)
 * @returns { isValid: boolean; estimatedTokens: number; warning?: string }
 */
export function validatePromptBudget(
  batch: EventScaffoldBatch,
  opts: PromptOptions = {},
  maxTokens: number = 14000
): { isValid: boolean; estimatedTokens: number; warning?: string } {
  const { system, user } = buildLabelPrompt(batch, opts);
  const estimated = estimatePromptTokens(system, user);

  if (estimated > maxTokens) {
    return {
      isValid: false,
      estimatedTokens: estimated,
      warning: `Batch ${batch.batch_id} exceeds token budget: ${estimated} > ${maxTokens}. Consider reducing batch size or excerpt length.`,
    };
  }

  if (estimated > maxTokens * 0.9) {
    return {
      isValid: true,
      estimatedTokens: estimated,
      warning: `Batch ${batch.batch_id} approaching budget: ${estimated}/${maxTokens} tokens (${((estimated / maxTokens) * 100).toFixed(0)}%)`,
    };
  }

  return { isValid: true, estimatedTokens: estimated };
}
