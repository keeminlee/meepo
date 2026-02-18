/**
 * scaffoldJoin.ts
 *
 * Join LLM-provided labels back to scaffold spans by event_id.
 *
 * Simple version (no fallbacks yet):
 * - Match event_id between batch items and LLM output
 * - Error if label missing or unknown event_id returned
 * - Preserve scaffold metadata (boundaries, dm_ratio, etc.)
 */

import type {
  EventScaffoldBatch,
  ScaffoldBatchItem,
  LabeledEvent,
  LabeledScaffoldEvent,
} from "./scaffoldBatchTypes.js";

export interface JoinResult {
  labeled: LabeledScaffoldEvent[];
  missingLabels: string[]; // event_ids without labels
  unknownEventIds: string[]; // event_ids in labels but not in batch
}

/**
 * Join LLM labels with scaffold batch items.
 *
 * @param batch - Original batch with scaffolds
 * @param labels - LLM output labels
 * @returns Labeled scaffold events + diagnostics
 */
export function applyLabels(
  batch: EventScaffoldBatch,
  labels: LabeledEvent[]
): JoinResult {
  const labelMap = new Map(labels.map((l) => [l.event_id, l]));
  const batchEventIds = new Set(batch.items.map((i) => i.event_id));

  const labeled: LabeledScaffoldEvent[] = [];
  const missingLabels: string[] = [];
  const unknownEventIds: string[] = [];

  // Join batch items with labels
  for (const item of batch.items) {
    const label = labelMap.get(item.event_id);

    if (!label) {
      missingLabels.push(item.event_id);
      continue;
    }

    labeled.push({
      ...item,
      title: label.title,
      event_type: label.event_type,
      is_ooc: label.is_ooc,
      importance: label.importance,
      participants: label.participants,
      label_batch_id: batch.batch_id,
    });
  }

  // Detect unknown event_ids in output
  for (const label of labels) {
    if (!batchEventIds.has(label.event_id)) {
      unknownEventIds.push(label.event_id);
    }
  }

  return { labeled, missingLabels, unknownEventIds };
}
