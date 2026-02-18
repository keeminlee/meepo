/**
 * scaffoldLabel.ts
 *
 * LLM-based labeling of scaffold batches.
 *
 * Strategy:
 * - Call LLM with batch + excerpts
 * - Parse JSON response
 * - Validate schema
 * - Single retry if parse/validation fails
 * - On final failure: throw (no fallback, let caller handle)
 */

import { chat } from "../llm/client.js";
import { normalizeEventType, isValidEventType } from "./scaffoldBatchTypes.js";
import type {
  EventScaffoldBatch,
  LabeledEvent,
  EventType,
} from "./scaffoldBatchTypes.js";
import {
  buildLabelPrompt,
  validatePromptBudget,
} from "./scaffoldLabelPrompt.js";

export interface LabelBatchResult {
  labels: LabeledEvent[];
  attemptCount: number;
  parseSuccess: boolean;
  validationErrors?: string[];
}

/**
 * Label a scaffold batch via LLM.
 *
 * @param batch - Batch with populated excerpts
 * @param model - LLM model (e.g., "gpt-4o-mini")
 * @param maxRetries - Don't retry JSON parse failures. Default: 1
 * @returns Labels + diagnostics
 * @throws Error if LLM call fails or final parse/validation fails
 */
export async function labelScaffoldBatch(
  batch: EventScaffoldBatch,
  model: string = "gpt-4o-mini",
  maxRetries: number = 1
): Promise<LabelBatchResult> {
  // Validate prompt budget first
  const budgetCheck = validatePromptBudget(batch);
  if (!budgetCheck.isValid) {
    throw new Error(budgetCheck.warning);
  }

  let attemptCount = 0;
  let lastError: Error | null = null;

  // Try up to maxRetries + 1 attempts (initial + retries)
  for (let attemptIdx = 0; attemptIdx <= maxRetries; attemptIdx++) {
    attemptCount++;

    try {
      // Build prompt
      const { system, user } = buildLabelPrompt(batch);

      // Call LLM
      const response = await chat({
        systemPrompt: system,
        userMessage: user,
        model,
        temperature: 0.2,
        maxTokens: 4000, // Response-only budget
      });

      // Parse JSON
      const labels = parseAndValidateResponse(response, batch.items.length);

      return {
        labels,
        attemptCount,
        parseSuccess: true,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attemptIdx < maxRetries) {
        // Retry: send stricter prompt
        try {
          const { system, user } = buildLabelPrompt(batch);
          const strictSystem =
            system +
            "\n\nIF YOU SEE THIS MESSAGE: Your first attempt had invalid JSON. Return ONLY valid JSON, no markdown or explanation.";

          const response = await chat({
            systemPrompt: strictSystem,
            userMessage: user,
            model,
            temperature: 0.1, // Lower temperature for stricter output
            maxTokens: 4000,
          });

          const labels = parseAndValidateResponse(
            response,
            batch.items.length
          );

          return {
            labels,
            attemptCount: attemptIdx + 1,
            parseSuccess: true,
          };
        } catch (retryErr) {
          // Retry also failed; fall through to throw original error
          lastError = retryErr instanceof Error ? retryErr : new Error(String(retryErr));
        }
      }
    }
  }

  // All attempts failed
  throw new Error(
    `Failed to label ${batch.batch_id} after ${attemptCount} attempt(s): ${lastError?.message}`
  );
}

/**
 * Parse and validate LLM response.
 *
 * @param response - Raw text response from LLM
 * @param expectedCount - Expected number of items in array
 * @returns Parsed + validated labels
 * @throws Error on parse or validation failure
 */
function parseAndValidateResponse(
  response: string,
  expectedCount: number
): LabeledEvent[] {
  // Extract JSON block (handle markdown code blocks)
  let jsonText = response.trim();

  // Strip markdown if present
  if (jsonText.includes("```json")) {
    const match = jsonText.match(/```json\s*([\s\S]*?)\s*```/);
    if (match) jsonText = match[1];
  } else if (jsonText.includes("```")) {
    const match = jsonText.match(/```\s*([\s\S]*?)\s*```/);
    if (match) jsonText = match[1];
  }

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (parseErr) {
    throw new Error(
      `Failed to parse JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}. ` +
        `First 200 chars: ${jsonText.substring(0, 200)}`
    );
  }

  // Validate structure
  if (!Array.isArray(parsed)) {
    throw new Error(`Expected JSON array, got ${typeof parsed}`);
  }

  if (parsed.length !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} items, got ${parsed.length}`
    );
  }

  // Validate each item
  const validationErrors: string[] = [];
  const labels: LabeledEvent[] = [];

  for (const [idx, item] of parsed.entries()) {
    if (typeof item !== "object" || item === null) {
      throw new Error(`Item ${idx} is not an object: ${typeof item}`);
    }

    const itemObj = item as Record<string, unknown>;

    // Required fields
    if (!itemObj.event_id || typeof itemObj.event_id !== "string") {
      throw new Error(
        `Item ${idx}: missing or invalid event_id (got: ${itemObj.event_id})`
      );
    }

    if (!itemObj.title || typeof itemObj.title !== "string") {
      validationErrors.push(`Item ${idx}: missing or invalid title`);
      itemObj.title = "Untitled";
    }

    if (typeof itemObj.event_type !== "string") {
      validationErrors.push(
        `Item ${idx}: missing or invalid event_type (got: ${itemObj.event_type})`
      );
      itemObj.event_type = "unknown";
    }

    if (typeof itemObj.is_ooc !== "boolean") {
      validationErrors.push(
        `Item ${idx}: is_ooc is not boolean (got: ${typeof itemObj.is_ooc}, value: ${itemObj.is_ooc})`
      );
      // Coerce: any truthy string "true"/"false" or default to false
      if (typeof itemObj.is_ooc === "string") {
        itemObj.is_ooc = itemObj.is_ooc.toLowerCase() === "true";
      } else {
        itemObj.is_ooc = false;
      }
    }

    // Normalize event_type
    let eventType: EventType = normalizeEventType(
      itemObj.event_type as string
    );

    // Optional fields
    let importance: 1 | 2 | 3 | 4 | 5 | undefined;
    if (itemObj.importance) {
      const imp = Number(itemObj.importance);
      if (imp >= 1 && imp <= 5) {
        importance = imp as 1 | 2 | 3 | 4 | 5;
      }
    }

    let participants: string[] | undefined;
    if (Array.isArray(itemObj.participants)) {
      participants = itemObj.participants
        .map((p) => (typeof p === "string" ? p : String(p)))
        .filter((p) => p.length > 0);
    }

    labels.push({
      event_id: itemObj.event_id,
      title: (itemObj.title as string).trim().slice(0, 200),
      event_type: eventType,
      is_ooc: itemObj.is_ooc as boolean,
      importance,
      participants,
    });
  }

  if (validationErrors.length > 0) {
    console.warn(`⚠️  Validation warnings: ${validationErrors.join("; ")}`);
  }

  return labels;
}
