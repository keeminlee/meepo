/**
 * compile-scaffold.ts: Build deterministic event scaffold for one or all sessions.
 *
 * CLI:
 *   npx tsx src/tools/compile-scaffold.ts --session C2E20 [--force] [--report]
 *   npx tsx src/tools/compile-scaffold.ts --all [--force] [--report]
 *
 * Flags:
 *   --force    Recompile even if scaffold already exists
 *   --report   Print human-readable boundary report to console
 *
 * The scaffold is built from bronze_transcript rows. Run compile-transcripts
 * first if bronze has not yet been compiled.
 */

import "dotenv/config";
import { fileURLToPath } from "node:url";
import { getDb } from "../db.js";
import {
  getOfficialSessionLabels,
  getOfficialSessionByLabel,
  type OfficialSessionRow,
} from "../sessions/officialSessions.js";
import { buildTranscript } from "../ledger/transcripts.js";
import { buildEventScaffold } from "../ledger/scaffoldBuilder.js";
import type { EventScaffold, ScaffoldOptions, BoundaryTrace } from "../ledger/scaffoldTypes.js";

// ── DB helpers ────────────────────────────────────────────────────────────────

function hasScaffold(sessionId: string): boolean {
  const db = getDb();
  const row = db
    .prepare(`SELECT 1 FROM event_scaffold WHERE session_id = ? LIMIT 1`)
    .get(sessionId) as any;
  return !!row;
}

function upsertScaffold(sessionId: string, events: EventScaffold[]): void {
  const db = getDb();
  const now = Date.now();

  const del = db.prepare(`DELETE FROM event_scaffold WHERE session_id = ?`);
  const ins = db.prepare(
    `INSERT INTO event_scaffold
       (event_id, session_id, start_index, end_index, boundary_reason, confidence,
        dm_ratio, signal_hits, compiled_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  db.transaction(() => {
    del.run(sessionId);
    for (const e of events) {
      ins.run(
        e.event_id,
        e.session_id,
        e.start_index,
        e.end_index,
        e.boundary_reason,
        e.confidence,
        e.dm_ratio,
        JSON.stringify(e.signal_hits),
        now
      );
    }
  })();
}

// ── Human-readable report ─────────────────────────────────────────────────────

function printReport(label: string, events: EventScaffold[]): void {
  console.log(`\n${"─".repeat(72)}`);
  console.log(`  Scaffold Report: ${label}  (${events.length} events)`);
  console.log(`${"─".repeat(72)}`);

  for (const e of events) {
    const spanLen = e.end_index - e.start_index + 1;
    const conf = (e.confidence * 100).toFixed(0).padStart(3);
    const dm = (e.dm_ratio * 100).toFixed(0).padStart(3);
    const hits = e.signal_hits.join(",") || "—";
    const idStr = e.event_id.padEnd(6);
    const rangeStr = `[${String(e.start_index).padStart(4)}–${String(e.end_index).padStart(4)}]`;
    const lenStr = `(${spanLen}L)`.padEnd(7);
    const reasonStr = e.boundary_reason.padEnd(18);

    console.log(
      `${idStr}  ${rangeStr} ${lenStr}  ${reasonStr}  conf=${conf}%  dm=${dm}%  hits=${hits}`
    );

    if (e.sample_lines && e.sample_lines.length > 0) {
      for (const s of e.sample_lines) {
        console.log(`         ↳ ${s}`);
      }
    }
  }

  console.log(`${"─".repeat(72)}\n`);
}

// ── Boundary trace output ─────────────────────────────────────────────────────

function printTrace(label: string, traces: BoundaryTrace[]): void {
  console.log(`\n${"─".repeat(100)}`);
  console.log(`  Boundary Trace: ${label}  (${traces.length} candidates)`);
  console.log(`${"─".repeat(100)}`);
  console.log(
    `  ${" │ "}  Line    │  Speaker             │  Signals              │  Conf  │  Status`
  );
  console.log(`${"─".repeat(100)}`);

  for (const t of traces) {
    const status = t.accepted ? "✓" : "✗";
    const lineStr = String(t.lineIndex).padStart(5);
    const speaker = t.speaker.padEnd(20);
    const signals =
      t.signalNames.length > 0
        ? t.signalNames.slice(0, 2).join(",").padEnd(22)
        : "—".padEnd(22);
    const conf = (t.confidence * 100).toFixed(0).padStart(3);

    let statusLine = `${t.accepted ? "ACCEPTED" : "REJECTED"}`;
    if (t.reason) statusLine += ` (${t.reason})`;

    console.log(`  ${status} │ ${lineStr}  │  ${speaker}  │  ${signals}  │  ${conf}%  │  ${statusLine}`);
  }

  console.log(`${"─".repeat(100)}\n`);
}

// ── Core: compile one session ─────────────────────────────────────────────────

function compileScaffoldForSession(
  session: OfficialSessionRow,
  force: boolean,
  report: boolean,
  trace: boolean,
  scaffoldOpts: ScaffoldOptions
): { eventCount: number; skipped: boolean; traces?: BoundaryTrace[] } {
  const { session_id, label } = session;

  if (!force && hasScaffold(session_id)) {
    return { eventCount: 0, skipped: true };
  }

  // Load transcript (prefers bronze, falls back to ledger)
  const lines = buildTranscript(session_id, true);
  if (lines.length === 0) {
    console.warn(`  ⚠️  ${label}: no transcript lines found, skipping.`);
    return { eventCount: 0, skipped: true };
  }

  const traces: BoundaryTrace[] = [];
  const events = buildEventScaffold(lines, session_id, scaffoldOpts, trace ? traces : undefined);
  upsertScaffold(session_id, events);

  console.log(`  ✅ ${label}: ${events.length} events  (${lines.length} lines)`);

  if (report) {
    printReport(label, events);
  }

  return { eventCount: events.length, skipped: false, traces: trace ? traces : undefined };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function parseArgs(): {
  mode: "all" | "session" | null;
  sessionLabel: string | null;
  force: boolean;
  report: boolean;
  trace: boolean;
} {
  const args = process.argv.slice(2);
  let mode: "all" | "session" | null = null;
  let sessionLabel: string | null = null;
  let force = false;
  let report = false;
  let trace = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--all") {
      mode = "all";
    } else if (args[i] === "--session" && args[i + 1]) {
      mode = "session";
      sessionLabel = args[i + 1];
      i++;
    } else if (args[i] === "--force") {
      force = true;
    } else if (args[i] === "--report") {
      report = true;
    } else if (args[i] === "--trace") {
      trace = true;
    }
  }

  return { mode, sessionLabel, force, report, trace };
}

async function main(): Promise<void> {
  const { mode, sessionLabel, force, report, trace } = parseArgs();

  if (!mode) {
    console.error(
      "Usage:\n" +
        "  compile-scaffold --session <LABEL> [--force] [--report] [--trace]\n" +
        "  compile-scaffold --all [--force] [--report] [--trace]"
    );
    process.exit(1);
  }

  const db = getDb();
  const scaffoldOpts: ScaffoldOptions = {
    minSpanLines: 25,
    maxSpanLines: 150,
    maxEvents: 80,
    includeSampleLines: report,
  };

  if (mode === "session") {
    if (!sessionLabel) {
      console.error("--session requires a label, e.g. --session C2E20");
      process.exit(1);
    }

    const session = getOfficialSessionByLabel(db, sessionLabel);
    if (!session) {
      console.error(`Session not found or is a test/chat session: ${sessionLabel}`);
      process.exit(1);
    }

    console.log(`\nBuilding scaffold for ${session.label} (${session.source})...`);
    const result = compileScaffoldForSession(session, force, report, trace, scaffoldOpts);

    if (result.skipped) {
      console.log(`  ⏭  ${session.label}: already compiled (use --force to recompile).`);
    } else if (result.traces) {
      printTrace(session.label, result.traces);
    }
    return;
  }

  // --all
  const labels = getOfficialSessionLabels(db);
  if (labels.length === 0) {
    console.log("No official sessions found.");
    return;
  }

  console.log(`\nBuilding event scaffold for ${labels.length} session(s)...\n`);

  let compiled = 0;
  let skipped = 0;
  let failed = 0;

  for (const label of labels) {
    const session = getOfficialSessionByLabel(db, label)!;
    try {
      const result = compileScaffoldForSession(session, force, report, trace, scaffoldOpts);
      if (result.skipped) {
        console.log(`  ⏭  ${label}: already compiled.`);
        skipped++;
      } else {
        compiled++;
        if (result.traces) {
          printTrace(label, result.traces);
        }
      }
    } catch (err: any) {
      console.error(`  ❌ ${label}: ${err.message ?? err}`);
      failed++;
    }
  }

  console.log(`\nDone. Compiled: ${compiled}, Skipped: ${skipped}, Failed: ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("Fatal:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
