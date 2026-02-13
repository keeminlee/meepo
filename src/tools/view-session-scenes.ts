/**
 * view-session-scenes.ts: Visualize a compiled session with scene-by-scene breakdown
 * 
 * CLI: npx tsx src/tools/view-session-scenes.ts --session <SESSION_ID> [--output file.txt]
 * 
 * Displays the transcript organized by extracted events with clean formatting.
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../db.js";

// Parse CLI arguments
function parseArgs(): { sessionId: string | null; outputFile: string | null } {
  const args = process.argv.slice(2);
  let sessionId: string | null = null;
  let outputFile: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--session" && args[i + 1]) {
      sessionId = args[i + 1];
      i++;
    }
    if (args[i] === "--output" && args[i + 1]) {
      outputFile = args[i + 1];
      i++;
    }
  }

  return { sessionId, outputFile };
}

// Get session info
function getSession(sessionId: string) {
  const db = getDb();
  const session = db
    .prepare("SELECT * FROM sessions WHERE session_id = ?")
    .get(sessionId) as any;

  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  return session;
}

// Get all ledger entries for session
function getSessionEntries(sessionId: string) {
  const db = getDb();
  const entries = db
    .prepare(
      `SELECT author_name, content, content_norm 
       FROM ledger_entries 
       WHERE session_id = ? AND source IN ('text', 'offline_ingest')
       ORDER BY timestamp_ms ASC, id ASC`
    )
    .all(sessionId) as Array<{ author_name: string; content: string; content_norm: string | null }>;

  return entries.map((e) => ({
    author: e.author_name,
    content: e.content_norm ?? e.content,
  }));
}

// Get all events for session
function getSessionEvents(sessionId: string) {
  const db = getDb();
  const events = db
    .prepare(
      `SELECT id, description, 
              ROW_NUMBER() OVER (ORDER BY timestamp_ms, id) as event_num,
              (SELECT COUNT(*) FROM events e2 WHERE e2.session_id = ? AND e2.timestamp_ms <= events.timestamp_ms) as cumulative_index
       FROM events 
       WHERE session_id = ?
       ORDER BY timestamp_ms ASC, id ASC`
    )
    .all(sessionId, sessionId) as any[];

  return events;
}

// Get event boundaries (which ledger indices belong to each event)
function getEventBoundaries(sessionId: string) {
  const db = getDb();
  
  // We need to map events back to transcript indices
  // Events store start/end indices as part of how we generate them
  // Actually, looking back at compile-session, we don't store those
  // So we'll reconstruct by getting all events and iterating through ledger
  
  const events = db
    .prepare(
      `SELECT id, description FROM events WHERE session_id = ? ORDER BY timestamp_ms ASC, id ASC`
    )
    .all(sessionId) as Array<{ id: string; description: string }>;

  const entries = db
    .prepare(
      `SELECT id, timestamp_ms FROM ledger_entries WHERE session_id = ? AND source IN ('text', 'offline_ingest') ORDER BY timestamp_ms ASC, id ASC`
    )
    .all(sessionId) as Array<{ id: string; timestamp_ms: number }>;

  // Map events to entry indices based on timestamp proximity
  // This is a heuristic: each event covers entries up to the next event's timestamp
  const boundaries = events.map((event, idx) => {
    const nextEventTime = idx < events.length - 1 ? events[idx + 1].description : null;
    // For now, we'll just show all entries and figure out the indices
    return {
      eventId: event.id,
      description: event.description,
      eventIndex: idx,
    };
  });

  return { events: boundaries, entryCount: entries.length };
}

// Build formatted output
function buildSceneVisualization(sessionId: string, entries: any[], session: any): string {
  const db = getDb();
  
  const events = db
    .prepare(`SELECT description, start_index, end_index FROM events WHERE session_id = ? AND is_recap = 0 ORDER BY start_index ASC`)
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

    // Use exact indices if available, otherwise skip
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

const db = getDb();

async function main() {
  const { sessionId, outputFile } = parseArgs();

  if (!sessionId) {
    console.error("❌ Missing required argument: --session <SESSION_ID>");
    console.error("Usage: npx tsx src/tools/view-session-scenes.ts --session <SESSION_ID> [--output file.txt]");
    process.exit(1);
  }

  try {
    console.log(`Loading session: ${sessionId}\n`);

    // Verify session exists
    const session = getSession(sessionId);
    console.log(`✓ Session: ${session.label || session.session_id}`);

    // Get entries and events
    const entries = getSessionEntries(sessionId);
    console.log(`✓ Loaded ${entries.length} transcript entries`);

    const events = db
      .prepare(`SELECT COUNT(*) as count FROM events WHERE session_id = ?`)
      .get(sessionId) as any;
    console.log(`✓ Loaded ${events.count} events`);

    // Build visualization
    const visualization = buildSceneVisualization(sessionId, entries, session);

    if (outputFile) {
      const outputPath = path.resolve(outputFile);
      fs.writeFileSync(outputPath, visualization, "utf8");
      console.log(`\n✅ Scene visualization written to: ${outputPath}\n`);
    } else {
      console.log("\n" + visualization);
    }
  } catch (err) {
    console.error("\n❌ Error:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
