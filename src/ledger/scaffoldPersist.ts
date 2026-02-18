/**
 * scaffoldPersist.ts
 *
 * Persist labeled scaffold events to database and export as JSON artifacts.
 *
 * DB: Upsert to events table (idempotent)
 * Files: Write JSON artifact to data/events/scaffolded_{label}.json
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../db.js";
import type { LabeledScaffoldEvent } from "./scaffoldBatchTypes.js";

export interface PersistOptions {
  /** Don't write to DB, only generate artifact. Default: false */
  dryRun?: boolean;

  /** Output directory for JSON artifacts. Default: "data/events" */
  artifactDir?: string;

  /** Include labeled events in artifact. Default: true */
  includeEvents?: boolean;
}

/**
 * Upsert labeled events to events table.
 *
 * Uses idempotent join key: (session_id, start_index, end_index, event_type)
 * Scaffold data (boundaries, dm_ratio, etc.) preserved in description.
 *
 * @param sessionId - Session UUID
 * @param labeled - Labeled scaffold events
 * @param opts - Options
 * @returns Count of inserted/updated rows
 */
export function persistLabeledEventsToDb(
  sessionId: string,
  labeled: LabeledScaffoldEvent[],
  opts: PersistOptions = {}
): number {
  if (opts.dryRun) {
    return 0;
  }

  const db = getDb();
  let upsertCount = 0;

  db.transaction(() => {
    for (const event of labeled) {
      // Idempotent identity key
      const existingEvent = db
        .prepare(
          `SELECT id FROM events 
           WHERE session_id = ? AND start_index = ? AND end_index = ? AND event_type = ?`
        )
        .get(sessionId, event.start_index, event.end_index, event.event_type) as
        | { id: string }
        | undefined;

      const eventId = existingEvent?.id ?? randomUUID();

      // Get timestamp from ledger (first entry in span)
      const transcriptRow = db
        .prepare(
          `SELECT timestamp_ms FROM ledger_entries WHERE session_id = ? ORDER BY timestamp_ms ASC LIMIT 1 OFFSET ?`
        )
        .get(sessionId, event.start_index) as { timestamp_ms: number } | undefined;

      const timestamp_ms = transcriptRow?.timestamp_ms ?? Date.now();

      // Extract participants from transcript (all unique authors in event span)
      // Use bronze_transcript if available (has line_index), otherwise fall back to ledger
      const participantRows = db
        .prepare(
          `SELECT DISTINCT author_name FROM bronze_transcript 
           WHERE session_id = ? 
             AND line_index >= ? 
             AND line_index <= ?`
        )
        .all(sessionId, event.start_index, event.end_index) as Array<{ author_name: string }>;
      
      const participants = participantRows.map(r => r.author_name);

      // Build description: title + scaffold context
      const description = [
        event.title,
        `[boundary: ${event.boundary_reason}, dm_ratio: ${(event.dm_ratio ?? 0).toFixed(2)}]`,
      ]
        .filter((s) => s.length > 0)
        .join(" - ");

      // Confidence: higher for strong signals + high DM ratio
      const baseConfidence = 0.75;
      const dmBonus = (event.dm_ratio ?? 0) * 0.1; // +0 to +0.1
      const confidence = Math.min(0.99, baseConfidence + dmBonus);

      // Upsert
      db.prepare(
        `INSERT OR REPLACE INTO events (
          id, session_id, event_type, participants, description,
          confidence, start_index, end_index, timestamp_ms, created_at_ms, is_ooc
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        eventId,
        sessionId,
        event.event_type,
        JSON.stringify(participants),
        description,
        confidence,
        event.start_index,
        event.end_index,
        timestamp_ms,
        Date.now(),
        event.is_ooc ? 1 : 0
      );

      upsertCount++;
    }
  })();

  return upsertCount;
}

/**
 * Export labeled events as JSON artifact.
 *
 * @param sessionLabel - Session label (e.g., "C2E20") for filename
 * @param labeled - Labeled scaffold events
 * @param opts - Options
 * @returns Path to written file (or null if skipped)
 */
export function exportLabeledEventsToJson(
  sessionLabel: string,
  labeled: LabeledScaffoldEvent[],
  opts: PersistOptions = {}
): string | null {
  const includeEvents = opts.includeEvents !== false; // default true
  if (!includeEvents) {
    return null;
  }

  const artifactDir = opts.artifactDir ?? "data/events";

  // Ensure directory exists
  if (!fs.existsSync(artifactDir)) {
    fs.mkdirSync(artifactDir, { recursive: true });
  }

  const filename = `events_${sessionLabel}.json`;
  const filepath = path.join(artifactDir, filename);

  // Get session_id from first ledger entry
  const db = getDb();
  const sessionRow = db
    .prepare(
      `SELECT session_id FROM ledger_entries WHERE session_id IN (
        SELECT session_id FROM sessions WHERE label = ?
      ) LIMIT 1`
    )
    .get(sessionLabel) as { session_id: string } | undefined;

  const sessionId = sessionRow?.session_id ?? "";

  const artifact = {
    events: labeled.map((e) => {
      // Get timestamp from first line in span
      const transcriptRow = db
        .prepare(
          `SELECT timestamp_ms FROM ledger_entries 
           WHERE session_id = ? 
           ORDER BY timestamp_ms ASC 
           LIMIT 1 OFFSET ?`
        )
        .get(sessionId, e.start_index) as { timestamp_ms: number } | undefined;

      const timestamp_ms = transcriptRow?.timestamp_ms ?? Date.now();

      // Extract participants from transcript (all unique authors in event span)
      // Use bronze_transcript if available (has line_index), otherwise fall back to ledger
      const participantRows = db
        .prepare(
          `SELECT DISTINCT author_name FROM bronze_transcript 
           WHERE session_id = ? 
             AND line_index >= ? 
             AND line_index <= ?`
        )
        .all(sessionId, e.start_index, e.end_index) as Array<{ author_name: string }>;
      
      const participants = participantRows.map(r => r.author_name);

      // Build description from title + metadata
      const description = e.title || `Event: ${e.event_type}`;

      // Confidence based on DM ratio (higher DM = more confident in label)
      const baseConfidence = 0.75;
      const dmBonus = (e.dm_ratio ?? 0) * 0.15;
      const confidence = Math.min(0.99, baseConfidence + dmBonus);

      return {
        id: e.event_id,
        session_id: sessionId,
        event_type: e.event_type,
        participants: participants,
        description: description,
        confidence: confidence,
        start_index: e.start_index,
        end_index: e.end_index,
        timestamp_ms: timestamp_ms,
        created_at_ms: Date.now(),
        is_ooc: e.is_ooc ? 1 : 0,
      };
    }),
  };

  fs.writeFileSync(filepath, JSON.stringify(artifact, null, 2));

  return filepath;
}

/**
 * Export labeled events as human-readable text visualization.
 *
 * @param sessionId - Session UUID
 * @param sessionLabel - Session label for filename
 * @param labeled - Labeled scaffold events
 * @param opts - Options
 * @returns Path to written file (or null if skipped)
 */
export function exportLabeledEventsToText(
  sessionId: string,
  sessionLabel: string,
  labeled: LabeledScaffoldEvent[],
  opts: PersistOptions = {}
): string | null {
  if (opts.dryRun) {
    return null;
  }

  const artifactDir = opts.artifactDir ?? "data/events";

  // Ensure directory exists
  if (!fs.existsSync(artifactDir)) {
    fs.mkdirSync(artifactDir, { recursive: true });
  }

  // Load transcript entries
  const db = getDb();
  const entries = db
    .prepare(
      `SELECT author_name, content FROM ledger_entries 
       WHERE session_id = ? AND source IN ('text', 'voice', 'offline_ingest') AND narrative_weight = 'primary'
       ORDER BY timestamp_ms ASC, id ASC`
    )
    .all(sessionId) as Array<{ author_name: string; content: string }>;

  // Build visualization
  let output = "";
  output += `${"═".repeat(80)}\n`;
  output += `SESSION: ${sessionLabel}\n`;
  output += `${"═".repeat(80)}\n\n`;

  // Filter to IC events only (exclude OOC)
  const icEvents = labeled.filter((e) => !e.is_ooc);

  for (const event of icEvents) {
    output += `\n${"─".repeat(80)}\n`;
    output += `${event.title || event.event_type}\n`;
    output += `${"─".repeat(80)}\n\n`;

    // Output transcript lines for this event
    for (let i = event.start_index; i <= event.end_index && i < entries.length; i++) {
      const entry = entries[i];
      output += `${entry.author_name}: ${entry.content}\n`;
    }
  }

  output += `\n${"═".repeat(80)}\n`;
  output += `END OF SESSION\n`;
  output += `${"═".repeat(80)}\n`;

  const filename = `events_${sessionLabel}.txt`;
  const filepath = path.join(artifactDir, filename);
  fs.writeFileSync(filepath, output, "utf-8");

  return filepath;
}

/**
 * Persist labeled events (DB + JSON artifact + text visualization).
 *
 * @param sessionId - Session UUID
 * @param sessionLabel - Session label for artifact filename
 * @param labeled - Labeled scaffold events
 * @param opts - Options
 * @returns Summary of what was persisted
 */
export function persistLabeledEvents(
  sessionId: string,
  sessionLabel: string,
  labeled: LabeledScaffoldEvent[],
  opts: PersistOptions = {}
): {
  dbUpserted: number;
  artifactPath: string | null;
  textPath: string | null;
} {
  const dbUpserted = persistLabeledEventsToDb(sessionId, labeled, opts);
  const artifactPath = exportLabeledEventsToJson(sessionLabel, labeled, opts);
  const textPath = exportLabeledEventsToText(sessionId, sessionLabel, labeled, opts);

  return { dbUpserted, artifactPath, textPath };
}
