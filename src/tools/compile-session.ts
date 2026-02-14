/**
 * compile-session.ts: Generate structured events from session transcript
 * 
 * CLI: npx tsx src/tools/compile-session.ts --session <SESSION_LABEL>
 * 
 * Behavior:
 * 1. Load session transcript from ledger
 * 2. Call LLM to extract structured events
 * 3. Validate: no gaps, no overlaps, ascending coverage
 * 4. UPSERT events into database (idempotent)
 * 5. Populate character_event_index with PC exposure classification
 */

import "dotenv/config";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { getDb } from "../db.js";
import { chat } from "../llm/client.js";

// Parse CLI arguments
function parseArgs(): { sessionId: string | null } {
  const args = process.argv.slice(2);
  let sessionId: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--session" && args[i + 1]) {
      sessionId = args[i + 1];
      i++;
    }
  }

  return { sessionId };
}

// Get session info
function getSession(sessionLabel: string) {
  const db = getDb();
  const session = db
    .prepare("SELECT * FROM sessions WHERE label = ?")
    .get(sessionLabel) as any;

  if (!session) {
    throw new Error(`Session not found: ${sessionLabel}`);
  }

  return session;
}

// Load transcript for session (in chronological order)
// Uses content_norm (normalized) if available, falls back to raw content
function loadSessionTranscript(sessionId: string): {
  text: string;
  entries: Array<{ index: number; author: string; content: string; timestamp: number }>;
} {
  const db = getDb();

  // Accept both 'text' (Discord messages) and 'offline_ingest' (ingested audio transcripts)
  // CRITICAL: Sort by timestamp_ms + id for deterministic ordering
  // If two entries have the same timestamp, secondary sort by id ensures stable index assignment
  const rows = db
    .prepare(
      `SELECT author_name, content, content_norm, timestamp_ms 
       FROM ledger_entries 
       WHERE session_id = ? AND source IN ('text', 'offline_ingest')
       ORDER BY timestamp_ms ASC, id ASC`
    )
    .all(sessionId) as Array<{ author_name: string; content: string; content_norm: string | null; timestamp_ms: number }>;

  if (rows.length === 0) {
    throw new Error(`No transcript found for session: ${sessionId} (checked for 'text' and 'offline_ingest' sources)`);
  }

  const entries = rows.map((r, idx) => ({
    index: idx,
    author: r.author_name,
    // Use normalized content if available, otherwise fall back to raw content
    content: r.content_norm ?? r.content,
    timestamp: r.timestamp_ms,
  }));

  const text = entries
    .map((e) => {
      const t = new Date(e.timestamp).toISOString();
      return `[${e.index}] [${t}] ${e.author}: ${e.content}`;
    })
    .join("\n");

  return { text, entries };
}

// Type for extracted events
interface ExtractedEvent {
  start_index: number;
  end_index: number;
  title: string;
  is_recap?: boolean;  // true if this event covers session recap/OOC preamble
}

// Validate events and collect issues (non-blocking)
function validateEvents(events: ExtractedEvent[], totalEntries: number): { isValid: boolean; issues: string[] } {
  const issues: string[] = [];

  if (events.length === 0) {
    issues.push("No events extracted from transcript");
    return { isValid: false, issues };
  }

  // Check for out-of-bounds indices
  for (let i = 0; i < events.length; i++) {
    if (events[i].start_index < 0 || events[i].start_index >= totalEntries) {
      issues.push(
        `Event ${i} "${events[i].title}": start_index ${events[i].start_index} out of bounds [0, ${totalEntries - 1}]`
      );
    }
    if (events[i].end_index < 0 || events[i].end_index >= totalEntries) {
      issues.push(
        `Event ${i} "${events[i].title}": end_index ${events[i].end_index} out of bounds [0, ${totalEntries - 1}]`
      );
    }
  }

  // If we have out-of-bounds, those are blockers
  if (issues.length > 0) {
    return { isValid: false, issues };
  }

  // Check ascending order
  for (let i = 1; i < events.length; i++) {
    if (events[i].start_index <= events[i - 1].start_index) {
      issues.push(
        `Events ${i - 1} and ${i} not in ascending order: event ${i} starts at ${events[i].start_index} after event ${i - 1} starts at ${events[i - 1].start_index}`
      );
    }
  }

  // Check for overlaps
  for (let i = 0; i < events.length - 1; i++) {
    if (events[i].end_index >= events[i + 1].start_index) {
      issues.push(
        `Events ${i} and ${i + 1} overlap: event ${i} (${events[i].start_index}-${events[i].end_index}) overlaps with event ${i + 1} (${events[i + 1].start_index}-${events[i + 1].end_index})`
      );
    }
  }

  // Check for gaps (warning only, not blocking)
  for (let i = 0; i < events.length - 1; i++) {
    const gap = events[i + 1].start_index - events[i].end_index - 1;
    if (gap > 0) {
      issues.push(
        `⚠️  Gap: ${gap} message(s) between event ${i} (ends at ${events[i].end_index}) and event ${i + 1} (starts at ${events[i + 1].start_index})`
      );
    }
  }

  // Return whether validation passed (gaps are warnings, not failures)
  const isValid = !issues.some((issue) => !issue.startsWith("⚠️"));

  return { isValid, issues };
}

// Call LLM to extract events
async function extractEvents(transcript: string, totalMessages: number): Promise<ExtractedEvent[]> {
  const systemPrompt = `You are an assistant that extracts narrative events from D&D session transcripts.

Your task is to identify distinct scenes, conflicts, discoveries, and major moments from the transcript.

IMPORTANT: Classify each event as EITHER recap/OOC OR actual gameplay:
- "is_recap": true for out-of-character chat, rule discussion, session recaps (e.g., "Last time on...", late-joiner recaps, DM housekeeping, player meta-talk)
- "is_recap": false for in-character gameplay, roleplay, actions, discoveries, etc.

Recap events can appear ANYWHERE in the transcript (start, middle, or scattered), not just at the beginning.
Example: mid-session "wait, what happened with the rogue last session?" should be marked as recap.

Return a JSON array of events in this format:
[
  { "start_index": 0, "end_index": 4, "title": "DM recap and table setup OOC", "is_recap": true },
  { "start_index": 5, "end_index": 12, "title": "Party enters the tavern", "is_recap": false },
  { "start_index": 13, "end_index": 15, "title": "Late joiner recap from player", "is_recap": true },
  { "start_index": 16, "end_index": 22, "title": "Encounter with the mysterious stranger", "is_recap": false },
  ...
]

Requirements:
- start_index and end_index refer to message indices shown as [N] at the start of each message line
- Valid indices are 0 to ${totalMessages - 1} (inclusive)
- Events must be contiguous (no gaps or overlaps)
- Each event should represent a distinct narrative beat, scene, or recap segment
- Titles should be brief and descriptive
- For EACH event, include is_recap: true or is_recap: false (be explicit)
- Return ONLY the JSON array, no other text

Example indices (if transcript has 10 messages):
- Valid indices: 0, 1, 2, 3, 4, 5, 6, 7, 8, 9
- start_index can be 0-9
- end_index can be 0-9
- For adjacent events: event1.end_index + 1 must equal event2.start_index`;

  const userMessage = `Extract narrative events from this D&D session transcript (${totalMessages} messages total).\n\n${transcript}`;

  const response = await chat({
    systemPrompt,
    userMessage,
    model: process.env.LLM_MODEL ?? "gpt-4o-mini",
    temperature: 0.2, // Lower temperature for consistency
    maxTokens: 2000,
  });

  try {
    const events = JSON.parse(response) as ExtractedEvent[];
    return events;
  } catch (err) {
    throw new Error(`Failed to parse LLM response as JSON: ${response}\n\nError: ${err}`);
  }
}

// UPSERT events into database (idempotent via stable identity)
// Events are identified by (session_id, start_index, end_index, event_type)
// This keeps event.id stable across reruns, preserving FK relationships in dependent tables
function upsertEvents(sessionId: string, events: ExtractedEvent[], transcriptEntries: any[]): void {
  const db = getDb();

  // Start transaction
  const upsertEventsTransaction = db.transaction(() => {
    let insertedCount = 0;
    let updatedCount = 0;

    for (const event of events) {
      const eventType = "narrative"; // Default event type for Phase 1C

      // Query for existing event with same identity key
      const existingEvent = db
        .prepare(
          `SELECT id FROM events 
           WHERE session_id = ? AND start_index = ? AND end_index = ? AND event_type = ?`
        )
        .get(sessionId, event.start_index, event.end_index, eventType) as { id: string } | undefined;

      // Reuse existing ID or generate new one
      const id = existingEvent?.id ?? randomUUID();

      const startEntry = transcriptEntries[event.start_index];
      const timestamp_ms = startEntry.timestamp;

      const participants = new Set<string>();
      for (let i = event.start_index; i <= event.end_index; i++) {
        participants.add(transcriptEntries[i].author);
      }

      // INSERT OR REPLACE: if row exists (by PK), update it; otherwise insert
      const result = db
        .prepare(
          `INSERT OR REPLACE INTO events (
            id, session_id, event_type, participants, description, 
            confidence, start_index, end_index, timestamp_ms, created_at_ms, is_recap
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          sessionId,
          eventType,
          JSON.stringify(Array.from(participants)),
          event.title,
          0.85, // Confidence from LLM extraction
          event.start_index,
          event.end_index,
          timestamp_ms,
          existingEvent ? Date.now() : Date.now(), // Keep original created_at_ms if updating
          event.is_recap ? 1 : 0
        );

      if (existingEvent) {
        updatedCount++;
      } else {
        insertedCount++;
      }
    }

    return { insertedCount, updatedCount };
  });

  try {
    const result = upsertEventsTransaction();
    console.log(
      `  Inserted ${result.insertedCount} new events, updated ${result.updatedCount} existing events`
    );
  } catch (err: any) {
    throw new Error(`Database transaction failed: ${err.message}`);
  }
}

// Load PCs from data/registry/pcs.yml
// Returns map of discord_user_id → pc_id
function loadPCRegistry(): Map<string, string> {
  const registryPath = path.join(process.cwd(), "data", "registry", "pcs.yml");
  const yaml = fs.readFileSync(registryPath, "utf8");
  const data = YAML.parse(yaml) as any;

  const pcMap = new Map<string, string>();
  if (data.characters && Array.isArray(data.characters)) {
    for (const pc of data.characters) {
      if (pc.id && pc.discord_user_id) {
        pcMap.set(pc.discord_user_id, pc.id);
      }
    }
  }

  return pcMap;
}

// Get all PCs from registry
function getAllPCs(): Array<{ id: string; canonical_name: string }> {
  const registryPath = path.join(process.cwd(), "data", "registry", "pcs.yml");
  const yaml = fs.readFileSync(registryPath, "utf8");
  const data = YAML.parse(yaml) as any;

  const pcs: Array<{ id: string; canonical_name: string }> = [];
  if (data.characters && Array.isArray(data.characters)) {
    for (const pc of data.characters) {
      if (pc.id && pc.canonical_name) {
        pcs.push({ id: pc.id, canonical_name: pc.canonical_name });
      }
    }
  }

  return pcs;
}

// Populate character_event_index with PC exposure classification
// For each event, determine which PCs spoke (direct) vs were party present (witnessed)
function populateCharacterEventIndex(sessionId: string, events: ExtractedEvent[]): void {
  const db = getDb();
  const authorIdToPcId = loadPCRegistry();
  const allPCs = getAllPCs();

  const populateTransaction = db.transaction(() => {
    // Delete existing entries for this session's events
    const eventIds = events.map((e) => {
      const existing = db
        .prepare(
          `SELECT id FROM events 
           WHERE session_id = ? AND start_index = ? AND end_index = ? AND event_type = 'narrative'`
        )
        .get(sessionId, e.start_index, e.end_index) as { id: string } | undefined;
      return existing?.id;
    }).filter((id): id is string => !!id);

    if (eventIds.length > 0) {
      const placeholders = eventIds.map(() => "?").join(",");
      const deletedCount = db
        .prepare(`DELETE FROM character_event_index WHERE event_id IN (${placeholders})`)
        .run(...eventIds);
      console.log(`  Deleting ${deletedCount.changes} existing PC exposures`);
    }

    // Get all ledger entries for this session (in order)
    const allEntries = db
      .prepare(
        `SELECT author_id, author_name
         FROM ledger_entries 
         WHERE session_id = ? AND source IN ('text', 'offline_ingest')
         ORDER BY timestamp_ms ASC, id ASC`
      )
      .all(sessionId) as Array<{ author_id: string; author_name: string }>;

    // For each event, classify PC exposure (skip recap events)
    let insertedCount = 0;
    for (const event of events) {
      // Skip recap events - they don't get PC exposure classification
      if (event.is_recap) {
        continue;
      }

      // Get the event ID from database
      const eventRow = db
        .prepare(
          `SELECT id FROM events 
           WHERE session_id = ? AND start_index = ? AND end_index = ? AND event_type = 'narrative'`
        )
        .get(sessionId, event.start_index, event.end_index) as { id: string } | undefined;

      if (!eventRow) {
        console.warn(
          `⚠️  Event not found for indices [${event.start_index}-${event.end_index}], skipping exposure classification`
        );
        continue;
      }

      const eventId = eventRow.id;

      // Build set of author_ids that appear in this event's span [start_index, end_index]
      const spanAuthorIds = new Set<string>();
      for (let i = event.start_index; i <= event.end_index && i < allEntries.length; i++) {
        if (allEntries[i]?.author_id) {
          spanAuthorIds.add(allEntries[i].author_id);
        }
      }

      // Classify each PC: direct if they spoke, witnessed otherwise
      for (const pc of allPCs) {
        // Find Discord author_id for this PC
        let pcAuthorId: string | null = null;
        for (const [authorId, mappedPcId] of authorIdToPcId) {
          if (mappedPcId === pc.id) {
            pcAuthorId = authorId;
            break;
          }
        }

        if (!pcAuthorId) {
          continue; // PC has no Discord mapping, skip
        }

        const exposureType = spanAuthorIds.has(pcAuthorId) ? "direct" : "witnessed";

        // INSERT OR REPLACE into character_event_index
        db.prepare(
          `INSERT OR REPLACE INTO character_event_index (event_id, pc_id, exposure_type, created_at_ms)
           VALUES (?, ?, ?, ?)`
        ).run(eventId, pc.id, exposureType, Date.now());

        insertedCount++;
      }
    }

    return insertedCount;
  });

  try {
    const count = populateTransaction();
    console.log(`  Inserted ${count} PC exposure entries`);
  } catch (err: any) {
    throw new Error(`Failed to populate character_event_index: ${err.message}`);
  }
}

async function main() {
  const { sessionId } = parseArgs();

  if (!sessionId) {
    console.error("❌ Missing required argument: --session <SESSION_LABEL>");
    console.error("Usage: npx tsx src/tools/compile-session.ts --session <SESSION_LABEL>");
    process.exit(1);
  }

  try {
    console.log(`\n📋 Compiling session: ${sessionId}\n`);

    // Verify session exists
    const session = getSession(sessionId);
    console.log(`✓ Session found: ${session.label || session.session_id}`);

    // Load transcript
    console.log("Loading transcript from ledger...");
    const { text: transcript, entries } = loadSessionTranscript(session.session_id);
    console.log(`✓ Loaded ${entries.length} messages`);

    // Extract events via LLM
    console.log("\nCalling LLM to extract events...");
    const events = await extractEvents(transcript, entries.length);
    console.log(`✓ Extracted ${events.length} events`);

    // Validate events
    console.log("\nValidating events...");
    const validation = validateEvents(events, entries.length);

    if (validation.issues.length > 0) {
      console.log(`\n⚠️  ${validation.issues.length} issue(s) found:\n`);
      validation.issues.forEach((issue) => {
        console.log(`  ${issue}`);
      });
      console.log();

      if (!validation.isValid) {
        console.error("❌ Critical validation errors found. Please check the issues above.");
        process.exit(1);
      }
    } else {
      console.log("✓ All validation passed");
    }

    // UPSERT into database
    console.log("\nUpserting events into database...");
    upsertEvents(session.session_id, events, entries);

    // Populate PC exposure index
    console.log("\nPopulating PC exposure classification...");
    populateCharacterEventIndex(session.session_id, events);

    // Summary
    console.log(`\n✅ Generated ${events.length} events for session\n`);
    for (const event of events) {
      console.log(`  [${event.start_index}-${event.end_index}] ${event.title}`);
    }

    console.log("\n✅ Session compilation complete!\n");
  } catch (err) {
    console.error("\n❌ Error:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
