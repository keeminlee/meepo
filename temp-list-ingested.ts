import { getDb } from "./src/db.js";
import type { Session } from "./src/sessions/sessions.js";

const db = getDb();
const rows = db.prepare("SELECT * FROM sessions WHERE source = 'ingest-media' ORDER BY created_at_ms DESC").all() as Session[];

if (rows.length === 0) {
  console.log("No ingested sessions found.");
} else {
  console.log(`\nFound ${rows.length} ingested session(s):\n`);
  rows.forEach((session, idx) => {
    const createdDate = new Date(session.created_at_ms).toISOString();
    console.log(`[${idx + 1}] ${session.label || "(no label)"}`);
    console.log(`    Session ID: ${session.session_id}`);
    console.log(`    Guild ID: ${session.guild_id}`);
    console.log(`    Created: ${createdDate}`);
    console.log(`    Duration: ${session.started_at_ms} - ${session.ended_at_ms}`);
    console.log();
  });
}
