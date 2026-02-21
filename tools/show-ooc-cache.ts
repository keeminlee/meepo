import { getDb } from "../src/db.js";

const db = getDb();
const rows = db
  .prepare(
    `SELECT session_id, span_start, span_end, classified_at_ms,
            json_array_length(classifications) as event_count,
            classifications
     FROM ooc_span_classifications
     ORDER BY span_start`,
  )
  .all() as Array<{
  session_id: string;
  span_start: number;
  span_end: number;
  classified_at_ms: number;
  event_count: number;
  classifications: string;
}>;

for (const r of rows) {
  const ts = new Date(r.classified_at_ms).toISOString();
  console.log(`\nspan [${r.span_start}-${r.span_end}]  events=${r.event_count}  classified=${ts}`);
  console.log(`session: ${r.session_id}`);
  const events = JSON.parse(r.classifications) as Array<{
    start_index: number;
    end_index: number;
    is_ooc: boolean;
  }>;
  for (const e of events) {
    const label = e.is_ooc ? "OOC" : " IC";
    console.log(`  [${String(e.start_index).padStart(4)}-${String(e.end_index).padStart(4)}]  ${label}`);
  }
}

console.log(`\nTotal cached spans: ${rows.length}`);
