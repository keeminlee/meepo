/**
 * compile-and-export-events.ts: Compile session events and export visualization
 * 
 * CLI: npx tsx src/tools/compile-and-export-events.ts --session <SESSION_LABEL> [--force]
 * 
 * Options:
 *   --force    Force recompilation even if events already exist in database
 * 
 * Behavior:
 * 1. Load session transcript from ledger
 * 2. Check for existing events (skip if found, unless --force)
 * 3. Call LLM to extract structured events (if needed)
 * 4. Validate: no gaps, no overlaps, ascending coverage
 * 5. UPSERT events into database (idempotent)
 * 6. Populate character_event_index with PC exposure classification
 * 7. Export human-readable visualization to data/session-events/events_{label}.txt
 */

import "dotenv/config";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as readline from "node:readline";
import YAML from "yaml";
import { getDb } from "../db.js";
import { buildTranscript } from "../ledger/transcripts.js";
import { chat } from "../llm/client.js";

const DEFAULT_NARRATIVE_WEIGHT = "primary";

// Parse CLI arguments
function parseArgs(): { sessionLabel: string | null; force: boolean } {
  const args = process.argv.slice(2);
  let sessionLabel: string | null = null;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--session" && args[i + 1]) {
      sessionLabel = args[i + 1];
      i++;
    } else if (args[i] === "--force") {
      force = true;
    }
  }

  return { sessionLabel, force };
}

// Get session info
function getSession(sessionLabel: string) {
  const db = getDb();
  const session = db
    .prepare("SELECT * FROM sessions WHERE label = ? ORDER BY created_at_ms DESC LIMIT 1")
    .get(sessionLabel) as any;

  if (!session) {
    throw new Error(`Session not found: ${sessionLabel}`);
  }

  return session;
}

// Load transcript for session (in chronological order)
// Uses shared transcript builder to ensure consistency with Meecap
function loadSessionTranscript(sessionId: string): {
  text: string;
  entries: Array<{ index: number; author: string; content: string; timestamp: number }>;
} {
  const transcriptEntries = buildTranscript(sessionId, true); // primaryOnly=true

  const entries = transcriptEntries.map((e) => ({
    index: e.line_index,
    author: e.author_name,
    content: e.content,
    timestamp: e.timestamp_ms,
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
  event_type: 'action' | 'dialogue' | 'discovery' | 'emotional' | 'conflict' | 'plan' | 'transition' | 'recap' | 'ooc_logistics';
  is_ooc?: boolean;
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

  const isValid = !issues.some((issue) => !issue.startsWith("⚠️"));

  return { isValid, issues };
}

// Call LLM to extract events
async function extractEvents(transcript: string, totalMessages: number): Promise<ExtractedEvent[]> {
  const systemPrompt = `You are an assistant that extracts narrative events from D&D session transcripts.

Your task is to segment the transcript into distinct, contiguous narrative events.

IMPORTANT: Classify each event with TWO dimensions:

------------------------------------------------------------
1. EVENT TYPE (choose EXACTLY ONE)
------------------------------------------------------------

- "action": Combat, physical challenges, movement, exploration
- "dialogue": Conversations, negotiations, social encounters, RP moments
- "discovery": Finding clues, learning information, revelations, lore
- "emotional": Character bonding, vulnerability, tension, reconciliation, personal growth
- "conflict": Arguments, disagreements, moral disputes, party friction
- "plan": In-world strategizing or deciding what to do next (before action occurs)
- "transition": Scene changes, time skips, location shifts, session openings/closings
- "recap": Summaries of prior in-world events
- "ooc_logistics": Table talk, rules discussion, scheduling, tech issues, meta conversation

------------------------------------------------------------
Dominance & Tie-Break Rules
------------------------------------------------------------

- If an interaction involves clear disagreement, accusation, or opposition → classify as "conflict" (even if spoken in dialogue).
- If the primary purpose is emotional vulnerability, bonding, tension, or relationship development → classify as "emotional".
- Otherwise, conversational exchanges default to "dialogue".
- If characters are deciding what to do next → "plan".
- If new information is revealed → "discovery".
- If nothing happens except a scene/time shift → "transition".
- If it summarizes earlier events → "recap".
- If it is table/meta talk → "ooc_logistics".

When uncertain, choose the category that represents the PRIMARY narrative function of the span.

Boundary Heuristic:
Start a new event when there is a clear shift in the dominant event_type or a switch between in-world vs OOC (is_ooc).
Do NOT split for single short interjections; prefer grouping until the new type/state persists for multiple lines or represents a distinct beat.

------------------------------------------------------------
2. HYGIENE FLAG
------------------------------------------------------------

- "is_ooc": true if the event is table/meta (rules, scheduling, tech, out-of-character talk)
- "is_ooc": false for in-character gameplay (including recap narration)

NOTE:
- "ooc_logistics" events MUST have is_ooc = true.
- "recap" events usually have is_ooc = false unless clearly meta.

------------------------------------------------------------
Output Format
------------------------------------------------------------

Return a JSON array of events in this format:

[
  { "start_index": 0, "end_index": 4, "title": "DM recap and table setup", "event_type": "recap", "is_ooc": false },
  { "start_index": 5, "end_index": 12, "title": "Party enters the tavern", "event_type": "transition", "is_ooc": false },
  { "start_index": 13, "end_index": 20, "title": "Cara challenges Evanora's decision", "event_type": "conflict", "is_ooc": false }
]

------------------------------------------------------------
Requirements
------------------------------------------------------------

- start_index and end_index refer to message indices shown as [N]
- Valid indices are 0 to ${totalMessages - 1} (inclusive)
- Events must be contiguous (no gaps or overlaps)
- Each event must represent a distinct narrative beat
- Titles should be brief and descriptive
- Choose EXACTLY ONE event_type per event
- Return ONLY the JSON array, no other text`;

  const userMessage = `Extract narrative events from this D&D session transcript (${totalMessages} messages total).\n\n${transcript}`;

  const response = await chat({
    systemPrompt,
    userMessage,
    model: process.env.LLM_MODEL ?? "gpt-4o-mini",
    temperature: 0.2,
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
function upsertEvents(sessionId: string, events: ExtractedEvent[], transcriptEntries: any[]): void {
  const db = getDb();

  // Start transaction
  const upsertEventsTransaction = db.transaction(() => {
    let insertedCount = 0;
    let updatedCount = 0;

    for (const event of events) {
      // Query for existing event with same identity key
      const existingEvent = db
        .prepare(
          `SELECT id FROM events 
           WHERE session_id = ? AND start_index = ? AND end_index = ? AND event_type = ?`
        )
        .get(sessionId, event.start_index, event.end_index, event.event_type) as { id: string } | undefined;

      // Reuse existing ID or generate new one
      const id = existingEvent?.id ?? randomUUID();

      const startEntry = transcriptEntries[event.start_index];
      const timestamp_ms = startEntry.timestamp;

      const participants = new Set<string>();
      for (let i = event.start_index; i <= event.end_index; i++) {
        participants.add(transcriptEntries[i].author);
      }

      // INSERT OR REPLACE
      db
        .prepare(
          `INSERT OR REPLACE INTO events (
            id, session_id, event_type, participants, description, 
            confidence, start_index, end_index, timestamp_ms, created_at_ms, is_ooc
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          sessionId,
          event.event_type,
          JSON.stringify(Array.from(participants)),
          event.title,
          0.85,
          event.start_index,
          event.end_index,
          timestamp_ms,
          existingEvent ? Date.now() : Date.now(),
          event.is_ooc ? 1 : 0
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

// Load PCs from registry
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

// Check if events already exist in database
function loadExistingEvents(sessionId: string): ExtractedEvent[] | null {
  const db = getDb();

  const existingEvents = db
    .prepare(
      `SELECT start_index, end_index, description as title, event_type, is_ooc 
       FROM events 
       WHERE session_id = ?
       ORDER BY start_index ASC`
    )
    .all(sessionId) as Array<{ 
      start_index: number; 
      end_index: number; 
      title: string; 
      event_type: string;
      is_ooc: number 
    }>;

  if (existingEvents.length === 0) {
    return null;
  }

  return existingEvents.map((e) => ({
    start_index: e.start_index,
    end_index: e.end_index,
    title: e.title,
    event_type: e.event_type as ExtractedEvent['event_type'],
    is_ooc: e.is_ooc === 1,
  }));
}

// Export events to JSON (full database row preview)
function exportEventsToJSON(
  sessionId: string,
  sessionLabel: string,
  events: ExtractedEvent[],
  entries: Array<{ author: string; content: string; timestamp: number }>
): void {
  const eventsDir = path.join(process.cwd(), "data", "session-events");
  if (!fs.existsSync(eventsDir)) {
    fs.mkdirSync(eventsDir, { recursive: true });
  }

  const outputPath = path.join(eventsDir, `events_${sessionLabel}.json`);

  const eventData = events.map((event) => {
    const startEntry = entries[event.start_index];
    const timestamp_ms = startEntry ? startEntry.timestamp : Date.now();

    const participants = new Set<string>();
    for (let i = event.start_index; i <= event.end_index && i < entries.length; i++) {
      participants.add(entries[i].author);
    }

    return {
      id: `<generated-at-upsert>`,
      session_id: sessionId,
      event_type: event.event_type,
      participants: Array.from(participants),
      description: event.title,
      confidence: 0.85,
      start_index: event.start_index,
      end_index: event.end_index,
      timestamp_ms,
      created_at_ms: `<generated-at-upsert>`,
      is_ooc: event.is_ooc ? 1 : 0,
    };
  });

  fs.writeFileSync(outputPath, JSON.stringify({ events: eventData }, null, 2), "utf-8");
  console.log(`✓ Event rows preview exported to ${outputPath}`);
}

// Populate character_event_index with PC exposure classification
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
           WHERE session_id = ? AND start_index = ? AND end_index = ? AND event_type = ?`
        )
        .get(sessionId, e.start_index, e.end_index, e.event_type) as { id: string } | undefined;
      return existing?.id;
    }).filter((id): id is string => !!id);

    if (eventIds.length > 0) {
      const placeholders = eventIds.map(() => "?").join(",");
      db
        .prepare(`DELETE FROM character_event_index WHERE event_id IN (${placeholders})`)
        .run(...eventIds);
    }

    // Get all ledger entries for this session
    const allEntries = db
      .prepare(
        `SELECT author_id, author_name
         FROM ledger_entries 
         WHERE session_id = ?
           AND source IN ('text', 'offline_ingest')
           AND narrative_weight = ?
         ORDER BY timestamp_ms ASC, id ASC`
      )
      .all(sessionId, DEFAULT_NARRATIVE_WEIGHT) as Array<{ author_id: string; author_name: string }>;

    // For each event, classify PC exposure (skip OOC events)
    let insertedCount = 0;
    for (const event of events) {
      // Skip OOC events (table talk, meta discussion, recaps, transitions)
      if (event.is_ooc || event.event_type === 'recap' || event.event_type === 'ooc_logistics' || event.event_type === 'transition') {
        continue;
      }

      // Get the event ID from database
      const eventRow = db
        .prepare(
          `SELECT id FROM events 
           WHERE session_id = ? AND start_index = ? AND end_index = ? AND event_type = ?`
        )
        .get(sessionId, event.start_index, event.end_index, event.event_type) as { id: string } | undefined;

      if (!eventRow) {
        console.warn(
          `⚠️  Event not found for indices [${event.start_index}-${event.end_index}], skipping exposure classification`
        );
        continue;
      }

      const eventId = eventRow.id;

      // Build set of author_ids that appear in this event's span
      const spanAuthorIds = new Set<string>();
      for (let i = event.start_index; i <= event.end_index && i < allEntries.length; i++) {
        if (allEntries[i]?.author_id) {
          spanAuthorIds.add(allEntries[i].author_id);
        }
      }

      // Classify each PC
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
          continue;
        }

        const exposureType = spanAuthorIds.has(pcAuthorId) ? "direct" : "witnessed";

        // INSERT OR REPLACE
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

// Check for memories that reference events in this session
function countDependentMemories(sessionId: string): number {
  const db = getDb();
  
  // This assumes memories table exists with event_id FK
  try {
    const tables = db.pragma("table_list") as any[];
    const hasMemoriesTable = tables.some((t: any) => t.name === "memories");
    
    if (!hasMemoriesTable) {
      return 0;
    }
    
    const result = db
      .prepare(
        `SELECT COUNT(*) as count FROM memories 
         WHERE event_id IN (SELECT id FROM events WHERE session_id = ?)`
      )
      .get(sessionId) as { count: number };
    
    return result.count;
  } catch {
    // Table doesn't exist or query fails
    return 0;
  }
}

// Prompt user for confirmation (synchronous via readline)
function promptForConfirmation(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${message} (yes/no): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "yes");
    });
  });
}

// Cascade delete: memories → character_event_index → events
function cascadeDeleteForRecompile(sessionId: string): void {
  const db = getDb();
  
  const deleteTransaction = db.transaction(() => {
    // Check if memories table exists
    const tables = db.pragma("table_list") as any[];
    const hasMemoriesTable = tables.some((t: any) => t.name === "memories");
    
    let deletedMemories = 0;
    if (hasMemoriesTable) {
      // Delete memories referencing events in this session
      const result = db
        .prepare(
          `DELETE FROM memories 
           WHERE event_id IN (SELECT id FROM events WHERE session_id = ?)`
        )
        .run(sessionId);
      deletedMemories = result.changes;
    }
    
    // Delete character_event_index entries
    const ceResult = db
      .prepare(
        `DELETE FROM character_event_index 
         WHERE event_id IN (SELECT id FROM events WHERE session_id = ?)`
      )
      .run(sessionId);
    
    // Delete events
    const eResult = db
      .prepare(`DELETE FROM events WHERE session_id = ?`)
      .run(sessionId);
    
    return { deletedMemories, deletedCharEventIndex: ceResult.changes, deletedEvents: eResult.changes };
  });
  
  try {
    const result = deleteTransaction();
    if (result.deletedMemories > 0) {
      console.log(`  ⚠️  Deleted ${result.deletedMemories} dependent memories`);
    }
    console.log(`  Deleted ${result.deletedCharEventIndex} PC exposure entries`);
    console.log(`  Deleted ${result.deletedEvents} events`);
  } catch (err: any) {
    throw new Error(`Cascade delete failed: ${err.message}`);
  }
}

// Build event visualization (from view-session-scenes.ts)
function buildEventVisualization(
  sessionId: string,
  entries: Array<{ author: string; content: string }>,
  session: any
): string {
  const db = getDb();

  const events = db
    .prepare(`SELECT description, start_index, end_index FROM events WHERE session_id = ? AND is_ooc = 0 ORDER BY start_index ASC`)
    .all(sessionId) as Array<{ description: string; start_index: number | null; end_index: number | null }>;

  if (events.length === 0) {
    return "No events found for this session.";
  }

  let output = "";
  output += `${"═".repeat(80)}\n`;
  output += `SESSION: ${session.label || session.session_id}\n`;
  output += `${"═".repeat(80)}\n\n`;

  for (const event of events) {
    output += `\n${"─".repeat(80)}\n`;
    output += `${event.description}\n`;
    output += `${"─".repeat(80)}\n\n`;

    // Use exact indices if available
    if (event.start_index !== null && event.end_index !== null) {
      const startIdx = event.start_index;
      const endIdx = event.end_index;

      for (let i = startIdx; i <= endIdx && i < entries.length; i++) {
        const entry = entries[i];
        output += `${entry.author}: ${entry.content}\n`;
      }
    } else {
      output += `[No transcript indices available for this event]\n`;
    }
  }

  output += `\n${"═".repeat(80)}\n`;
  output += `END OF SESSION\n`;
  output += `${"═".repeat(80)}\n`;

  return output;
}

export async function compileAndExportSession(sessionLabel: string, force: boolean): Promise<void> {
  try {
    console.log(`\n📋 Compiling session: ${sessionLabel}\n`);

    // Verify session exists
    const session = getSession(sessionLabel);
    console.log(`✓ Session found: ${session.label || session.session_id}`);

    // Load transcript
    console.log("Loading transcript from ledger...");
    const { text: transcript, entries } = loadSessionTranscript(session.session_id);
    console.log(`✓ Loaded ${entries.length} messages`);

    // Check if events already compiled
    console.log("\nChecking for existing events...");
    let events = force ? null : loadExistingEvents(session.session_id);
    let needsUpsert = false;

    if (events && events.length > 0 && !force) {
      console.log(`✓ Found ${events.length} existing events`);
      console.log("  (Skipping LLM extraction, using existing events)");
    } else {
      if (force) {
        console.log("  --force flag set, forcing recompilation");
        
        // Check for dependent memories before cascade delete
        const memoryCount = countDependentMemories(session.session_id);
        if (memoryCount > 0) {
          console.log(`\n⚠️  WARNING: Found ${memoryCount} memory/memories referencing events in this session`);
          console.log("  Recompiling with --force will DELETE these memories (they reference old event IDs)");
          
          const confirmed = await promptForConfirmation("\nProceed with cascade delete?");
          if (!confirmed) {
            console.log("Aborted. No changes made.");
            process.exit(0);
          }
          
          console.log("\nCascade deleting...");
          cascadeDeleteForRecompile(session.session_id);
        } else {
          console.log("  (No dependent memories found)");
          
          // Still delete events/indexes for clean slate
          const ceResult = getDb()
            .prepare(
              `DELETE FROM character_event_index 
               WHERE event_id IN (SELECT id FROM events WHERE session_id = ?)`
            )
            .run(session.session_id);
          
          const eResult = getDb()
            .prepare(`DELETE FROM events WHERE session_id = ?`)
            .run(session.session_id);
          
          console.log(`  Deleted ${ceResult.changes} PC exposure entries and ${eResult.changes} events`);
        }
      }
      
      // Extract events via LLM
      console.log("\nCalling LLM to extract events...");
      const extracted = await extractEvents(transcript, entries.length);
      events = extracted;
      needsUpsert = true;
      console.log(`✓ Extracted ${events.length} events`);
    }

    // Validate events (even if loaded from DB, validate for consistency)
    console.log("Validating events...");
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

    // Upsert if newly extracted
    if (needsUpsert) {
      console.log("\nUpserting events into database...");
      upsertEvents(session.session_id, events, entries);

      console.log("Populating PC exposure classification...");
      populateCharacterEventIndex(session.session_id, events);
    } else {
      console.log("\n✓ Events already in database (skipping upsert)");
    }

    // Build and export visualization
    console.log("\nBuilding event visualization...");
    const entriesForViz = entries.map((e) => ({
      author: e.author,
      content: e.content,
    }));
    const visualization = buildEventVisualization(session.session_id, entriesForViz, session);

    // Write files
    const eventsDir = path.join(process.cwd(), "data", "session-events");
    if (!fs.existsSync(eventsDir)) {
      fs.mkdirSync(eventsDir, { recursive: true });
    }

    const txtPath = path.join(eventsDir, `events_${session.label}.txt`);
    fs.writeFileSync(txtPath, visualization, "utf-8");
    console.log(`✓ Visualization exported to ${txtPath}`);

    // Export JSON (database row preview)
    exportEventsToJSON(session.session_id, session.label, events, entries);

    // Summary
    console.log(`\n✅ Generated ${events.length} events for session\n`);
    for (const event of events) {
      console.log(`  [${event.start_index}-${event.end_index}] [${event.event_type}] ${event.title}`);
    }

    console.log(`\n✅ Session compilation and export complete!\n`);
  } catch (err) {
    console.error("\n❌ Error:", err instanceof Error ? err.message : err);
    throw err;
  }
}

async function main() {
  const { sessionLabel, force } = parseArgs();

  if (!sessionLabel) {
    console.error("❌ Missing required argument: --session <SESSION_LABEL>");
    console.error("Usage: npx tsx src/tools/compile-and-export-events.ts --session <SESSION_LABEL> [--force]");
    console.error("Options:");
    console.error("  --force    Force recompilation even if events already exist");
    process.exit(1);
  }

  try {
    await compileAndExportSession(sessionLabel, force);
  } catch {
    process.exit(1);
  }
}

main();
