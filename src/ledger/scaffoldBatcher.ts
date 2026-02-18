/**
 * scaffoldBatcher.ts
 *
 * Partition scaffold spans into batches for LLM labeling.
 *
 * One batch = up to 10 spans
 * Deterministic batch IDs for reproducibility and debugging
 */

import type { EventScaffold } from "./scaffoldTypes.js";
import type { EventScaffoldBatch, ScaffoldBatchItem } from "./scaffoldBatchTypes.js";

export interface BatcherOptions {
  /** Items per batch. Default: 10 */
  batchSize?: number;

  /** Include optional context notes in batch. Default: true */
  includeMetadata?: boolean;
}

/**
 * Partition scaffold spans into batches.
 *
 * @param scaffold - Array of event scaffolds (must be ordered by start_index)
 * @param sessionId - Session UUID
 * @param sessionLabel - Session label (e.g., "C2E20") for logging
 * @param opts - Batching configuration
 * @returns Array of batches
 */
export function batchScaffold(
  scaffold: EventScaffold[],
  sessionId: string,
  sessionLabel?: string,
  opts: BatcherOptions = {}
): EventScaffoldBatch[] {
  const batchSize = opts.batchSize ?? 10;

  if (scaffold.length === 0) {
    return [];
  }

  const batches: EventScaffoldBatch[] = [];

  for (let batchIndex = 0; batchIndex < scaffold.length; batchIndex += batchSize) {
    const batchNumber = Math.floor(batchIndex / batchSize);
    const batchId = `BATCH_${String(batchNumber).padStart(4, "0")}`;

    const spanSlice = scaffold.slice(batchIndex, batchIndex + batchSize);

    const items: ScaffoldBatchItem[] = spanSlice.map((span) => ({
      event_id: span.event_id,
      start_index: span.start_index,
      end_index: span.end_index,
      boundary_reason: span.boundary_reason,
      dm_ratio: span.dm_ratio,
      excerpt: "", // Will be populated by caller
    }));

    batches.push({
      batch_id: batchId,
      session_id: sessionId,
      session_label: sessionLabel,
      items,
    });
  }

  return batches;
}

/**
 * Utility: Get summary stats for a batch.
 */
export function getBatchStats(batch: EventScaffoldBatch): {
  batchId: string;
  itemCount: number;
  eventIds: string[];
  totalExcerptLines: number;
  avgExcerptLines: number;
} {
  const excerptLines = batch.items
    .map((item) => item.excerpt.split("\n").length)
    .reduce((a, b) => a + b, 0);

  return {
    batchId: batch.batch_id,
    itemCount: batch.items.length,
    eventIds: batch.items.map((i) => i.event_id),
    totalExcerptLines: excerptLines,
    avgExcerptLines: Math.round(excerptLines / batch.items.length),
  };
}
