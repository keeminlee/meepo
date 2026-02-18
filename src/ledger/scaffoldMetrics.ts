/**
 * scaffoldMetrics.ts
 *
 * Structured metrics collection and reporting for batch LLM labeling.
 *
 * Tracks:
 * - Per-batch: latency, items, parse retries, type breakdown
 * - Per-session: total events, OOC ratio, event type distribution
 * - Logging: human-readable + machine-readable formats
 */

import type { EventScaffoldBatch, LabeledScaffoldEvent } from "./scaffoldBatchTypes.js";

// ── Per-batch metrics ──────────────────────────────────────────────────────

export interface BatchMetrics {
  batch_id: string;
  session_label?: string;
  event_ids: string[];
  item_count: number;
  total_excerpt_lines: number;
  avg_excerpt_lines: number;
  llm_latency_ms: number;
  llm_attempts: number;
  parse_success: boolean;
  labeled_count: number;
  missing_labels: string[];
  unknown_event_ids: string[];
  event_type_breakdown: Record<string, number>;
  ooc_count: number;
}

export interface SessionMetrics {
  session_label: string;
  source: "live" | "ingest-media";
  total_events: number;
  total_batches: number;
  successful_batches: number;
  failed_batches: number;
  total_latency_ms: number;
  avg_latency_per_batch_ms: number;
  event_type_breakdown: Record<string, number>;
  ooc_count: number;
  ooc_percent: number;
}

// ── Metrics collector ──────────────────────────────────────────────────────

export class MetricsCollector {
  private batches: BatchMetrics[] = [];
  private sessionLabel: string;
  private sessionSource: "live" | "ingest-media" = "live";

  constructor(sessionLabel: string, sessionSource?: "live" | "ingest-media") {
    this.sessionLabel = sessionLabel;
    if (sessionSource) this.sessionSource = sessionSource;
  }

  recordBatch(
    batch: EventScaffoldBatch,
    latencyMs: number,
    llmAttempts: number,
    labeled: LabeledScaffoldEvent[],
    missingLabels: string[],
    unknownEventIds: string[]
  ): void {
    const typeBreakdown: Record<string, number> = {};
    let oocCount = 0;

    for (const event of labeled) {
      typeBreakdown[event.event_type] = (typeBreakdown[event.event_type] ?? 0) + 1;
      if (event.is_ooc) oocCount++;
    }

    const totalLines = batch.items.reduce(
      (sum, item) => sum + item.excerpt.split("\n").length,
      0
    );

    this.batches.push({
      batch_id: batch.batch_id,
      session_label: batch.session_label,
      event_ids: batch.items.map((i) => i.event_id),
      item_count: batch.items.length,
      total_excerpt_lines: totalLines,
      avg_excerpt_lines: Math.round(totalLines / batch.items.length),
      llm_latency_ms: latencyMs,
      llm_attempts: llmAttempts,
      parse_success: missingLabels.length === 0 && unknownEventIds.length === 0,
      labeled_count: labeled.length,
      missing_labels: missingLabels,
      unknown_event_ids: unknownEventIds,
      event_type_breakdown: typeBreakdown,
      ooc_count: oocCount,
    });
  }

  getSessionMetrics(allLabeled: LabeledScaffoldEvent[]): SessionMetrics {
    const typeBreakdown: Record<string, number> = {};
    let oocCount = 0;

    for (const event of allLabeled) {
      typeBreakdown[event.event_type] = (typeBreakdown[event.event_type] ?? 0) + 1;
      if (event.is_ooc) oocCount++;
    }

    const successfulBatches = this.batches.filter((b) => b.parse_success).length;
    const totalLatency = this.batches.reduce((sum, b) => sum + b.llm_latency_ms, 0);

    return {
      session_label: this.sessionLabel,
      source: this.sessionSource,
      total_events: allLabeled.length,
      total_batches: this.batches.length,
      successful_batches: successfulBatches,
      failed_batches: this.batches.length - successfulBatches,
      total_latency_ms: totalLatency,
      avg_latency_per_batch_ms: this.batches.length > 0 ? Math.round(totalLatency / this.batches.length) : 0,
      event_type_breakdown: typeBreakdown,
      ooc_count: oocCount,
      ooc_percent: allLabeled.length > 0 ? (oocCount / allLabeled.length) * 100 : 0,
    };
  }

  printBatchLog(metrics: BatchMetrics): void {
    const status = metrics.parse_success ? "✅" : "⚠️";
    const typeList = Object.entries(metrics.event_type_breakdown)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `${count} ${type}`)
      .join(", ");

    console.log(`${status} [${metrics.batch_id}] ${metrics.session_label || "?"}`);
    console.log(`   Events: ${metrics.item_count} items → ${metrics.labeled_count} labeled`);
    console.log(`   Excerpts: ${metrics.total_excerpt_lines} lines (avg ${metrics.avg_excerpt_lines} L/item)`);
    console.log(`   LLM: ${(metrics.llm_latency_ms / 1000).toFixed(2)}s (${metrics.llm_attempts} attempt${metrics.llm_attempts > 1 ? "s" : ""})`);
    console.log(`   Types: ${typeList}`);
    console.log(`   OOC: ${metrics.ooc_count}/${metrics.item_count} (${((metrics.ooc_count / metrics.item_count) * 100).toFixed(0)}%)`);

    if (!metrics.parse_success) {
      if (metrics.missing_labels.length > 0) {
        console.log(`   ❌ Missing labels: ${metrics.missing_labels.join(", ")}`);
      }
      if (metrics.unknown_event_ids.length > 0) {
        console.log(`   ⚠️  Unknown IDs in output: ${metrics.unknown_event_ids.join(", ")}`);
      }
    }

    console.log("");
  }

  printSessionSummary(sessionMetrics: SessionMetrics): void {
    console.log(`\n${"=".repeat(70)}`);
    console.log(`SUMMARY: ${sessionMetrics.session_label} (${sessionMetrics.source})`);
    console.log(`${"=".repeat(70)}`);

    console.log(`\n📊 Events`);
    console.log(`  Total: ${sessionMetrics.total_events}`);
    console.log(`  Batches: ${sessionMetrics.total_batches} (${sessionMetrics.successful_batches} successful, ${sessionMetrics.failed_batches} failed)`);

    console.log(`\n⏱️  Performance`);
    console.log(`  Total latency: ${(sessionMetrics.total_latency_ms / 1000).toFixed(2)}s`);
    console.log(`  Avg per batch: ${sessionMetrics.avg_latency_per_batch_ms}ms`);

    console.log(`\n📋 Event Types`);
    const sortedTypes = Object.entries(sessionMetrics.event_type_breakdown).sort(
      (a, b) => b[1] - a[1]
    );
    for (const [type, count] of sortedTypes) {
      const pct = ((count / sessionMetrics.total_events) * 100).toFixed(1);
      console.log(`  ${type}: ${count} (${pct}%)`);
    }

    console.log(`\n🎭 OOC Events`);
    console.log(`  Count: ${sessionMetrics.ooc_count}/${sessionMetrics.total_events} (${sessionMetrics.ooc_percent.toFixed(1)}%)`);

    console.log(`\n${"=".repeat(70)}\n`);
  }

  getMetricsJSON(): {
    session: SessionMetrics;
    batches: BatchMetrics[];
  } {
    return {
      session: this.getSessionMetrics([]),
      batches: this.batches,
    };
  }
}
