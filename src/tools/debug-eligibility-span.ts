/**
 * Debug why a transcript span is masked: show which chunks and excluded ranges overlap it.
 * Usage: npx tsx src/tools/debug-eligibility-span.ts <sessionLabel> [startLine] [endLine]
 * Default span: 676-701
 */
import "dotenv/config";
import { getDb } from "../db.js";
import { buildTranscript } from "../ledger/transcripts.js";
import { generateRegimeMasks, type RegimeChunk } from "../causal/pruneRegimes.js";
import { buildRefinedEligibilityMask, logEligibilitySummary } from "../causal/eligibilityMask.js";

function getSession(sessionLabel: string) {
  const db = getDb();
  const row = db
    .prepare("SELECT session_id, label FROM sessions WHERE label = ? ORDER BY created_at_ms DESC LIMIT 1")
    .get(sessionLabel) as { session_id: string; label: string } | undefined;
  if (!row) throw new Error(`Session not found: ${sessionLabel}`);
  return row;
}

function loadScaffoldChunks(sessionId: string): RegimeChunk[] {
  const db = getDb();
  const scaffold = db
    .prepare(
      `SELECT event_id, start_index, end_index
       FROM event_scaffold
       WHERE session_id = ?
       ORDER BY start_index ASC`,
    )
    .all(sessionId) as Array<{ event_id: string; start_index: number; end_index: number }>;

  const events = db
    .prepare(`SELECT start_index, end_index, is_ooc FROM events WHERE session_id = ?`)
    .all(sessionId) as Array<{ start_index: number; end_index: number; is_ooc: number }>;

  const oocMap = new Map(events.map((e) => [`${e.start_index}:${e.end_index}`, e.is_ooc === 1]));

  return scaffold.map((row, idx) => ({
    chunk_id: row.event_id,
    chunk_index: idx,
    start_index: row.start_index,
    end_index: row.end_index,
    is_ooc: oocMap.get(`${row.start_index}:${row.end_index}`),
  }));
}

async function main() {
  const sessionLabel = process.argv[2] ?? "C2E20";
  const spanStart = process.argv[3] != null ? parseInt(process.argv[3], 10) : 676;
  const spanEnd = process.argv[4] != null ? parseInt(process.argv[4], 10) : 701;

  const session = getSession(sessionLabel);
  const sessionId = session.session_id;
  const transcript = buildTranscript(sessionId, true);
  const chunks = loadScaffoldChunks(sessionId);
  const regimeMasks = generateRegimeMasks(chunks, transcript, {});

  // Chunks that overlap the span
  const overlappingChunks = chunks.filter(
    (c) => c.end_index >= spanStart && c.start_index <= spanEnd,
  );
  console.error(`\n=== Chunks overlapping L${spanStart}–L${spanEnd} (session ${sessionLabel}) ===`);
  if (overlappingChunks.length === 0) {
    console.error("No chunk overlaps this span (span may be outside transcript).");
  } else {
    for (const c of overlappingChunks) {
      const inOocHard = regimeMasks.oocHard.some((s) => s.start_index === c.start_index && s.end_index === c.end_index);
      const inOocSoft = regimeMasks.oocSoft.some((s) => s.start_index === c.start_index && s.end_index === c.end_index);
      const inCombat = regimeMasks.combat.some((s) => s.start_index === c.start_index && s.end_index === c.end_index);
      console.error(
        `  chunk ${c.chunk_index} [${c.start_index}-${c.end_index}] id=${c.chunk_id} is_ooc=${c.is_ooc} → oocHard=${inOocHard} oocSoft=${inOocSoft} combat=${inCombat}`,
      );
    }
  }

  console.error("\n=== Building refined eligibility mask (may call OOC cache/LLM) ===");
  const mask = await buildRefinedEligibilityMask(transcript, regimeMasks, sessionId, undefined, false);
  logEligibilitySummary(mask, { span: [spanStart, spanEnd] });
  console.error("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
