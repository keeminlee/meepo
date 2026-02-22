/**
 * compile-transcripts.ts: Build bronze_transcript rows for one or all official sessions.
 *
 * CLI:
 *   npx tsx src/tools/compile-transcripts.ts --all           # all official sessions
 *   npx tsx src/tools/compile-transcripts.ts --session C2E10 # one session
 *   npx tsx src/tools/compile-transcripts.ts --all --force   # recompile even if exists
 *
 * For live sessions (source='live'):
 *   Consecutive same-speaker voice utterances within VOICE_FUSE_GAP_MS are merged
 *   into a single bronze line (source_type='voice_fused'). Text entries pass through 1:1.
 *
 * For ingest-media sessions (source='ingest-media'):
 *   All entries are stored 1:1, no merging. offline_ingest lines are already clean.
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "../db.js";
import {
  getOfficialSessionLabels,
  getOfficialSessionByLabel,
  type OfficialSessionRow,
} from "../sessions/officialSessions.js";

// ── Config ──────────────────────────────────────────────────────────────────

/** Max gap between consecutive same-speaker voice entries to fuse (ms). */
const VOICE_FUSE_GAP_MS = 6000;

// ── Types ────────────────────────────────────────────────────────────────────

interface RawEntry {
  id: string;
  author_name: string;
  content: string;
  content_norm: string | null;
  timestamp_ms: number;
  t_end_ms: number | null;
  source: string; // 'text' | 'voice' | 'offline_ingest' | 'system'
}

interface BronzeLine {
  line_index: number;
  author_name: string;
  content: string;
  timestamp_ms: number;
  source_type: "voice_fused" | "voice" | "text" | "offline_ingest" | string;
  source_ids: string[];
}

// ── Core: Transcript compiler ─────────────────────────────────────────────────

function loadRawEntries(sessionId: string): RawEntry[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, author_name, content, content_norm, timestamp_ms, t_end_ms, source
       FROM ledger_entries
       WHERE session_id = ?
         AND source IN ('text', 'voice', 'offline_ingest')
         AND narrative_weight = 'primary'
       ORDER BY timestamp_ms ASC, id ASC`
    )
    .all(sessionId) as RawEntry[];
}

/**
 * Fuse same-speaker consecutive voice entries within VOICE_FUSE_GAP_MS.
 * Non-voice entries are passed through unchanged.
 */
function fuseVoiceEntries(entries: RawEntry[]): BronzeLine[] {
  const result: BronzeLine[] = [];
  let i = 0;

  while (i < entries.length) {
    const entry = entries[i];
    const normalizedContent = entry.content_norm ?? entry.content;

    if (entry.source === "voice") {
      // Attempt to fuse with subsequent same-speaker voice entries
      const group: RawEntry[] = [entry];
      let j = i + 1;

      while (j < entries.length) {
        const next = entries[j];
        if (next.source !== "voice") break;
        if (next.author_name !== entry.author_name) break;

        // Use t_end_ms of previous entry if available; fall back to timestamp_ms
        const prev = group[group.length - 1];
        const prevEndMs = prev.t_end_ms ?? prev.timestamp_ms;
        const gap = next.timestamp_ms - prevEndMs;
        if (gap > VOICE_FUSE_GAP_MS) break;

        group.push(next);
        j++;
      }

      const fusedContent = group
        .map((e) => e.content_norm ?? e.content)
        .join(" ");

      result.push({
        line_index: result.length,
        author_name: entry.author_name,
        content: fusedContent,
        timestamp_ms: entry.timestamp_ms,
        source_type: group.length > 1 ? "voice_fused" : "voice",
        source_ids: group.map((e) => e.id),
      });

      i = j;
    } else {
      // text / offline_ingest — no fusion
      result.push({
        line_index: result.length,
        author_name: entry.author_name,
        content: normalizedContent,
        timestamp_ms: entry.timestamp_ms,
        source_type: entry.source,
        source_ids: [entry.id],
      });
      i++;
    }
  }

  return result;
}

/**
 * For ingest-media sessions: 1:1 mapping, no fusion.
 */
function mapIngestEntries(entries: RawEntry[]): BronzeLine[] {
  return entries.map((entry, idx) => ({
    line_index: idx,
    author_name: entry.author_name,
    content: entry.content_norm ?? entry.content,
    timestamp_ms: entry.timestamp_ms,
    source_type: entry.source,
    source_ids: [entry.id],
  }));
}

// ── Core: Upsert into DB ──────────────────────────────────────────────────────

function upsertBronzeTranscript(sessionId: string, lines: BronzeLine[]): void {
  const db = getDb();
  const now = Date.now();

  const insert = db.prepare(
    `INSERT OR REPLACE INTO bronze_transcript
       (session_id, line_index, author_name, content, timestamp_ms, source_type, source_ids, compiled_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const deleteOld = db.prepare(
    `DELETE FROM bronze_transcript WHERE session_id = ?`
  );

  const runAll = db.transaction(() => {
    deleteOld.run(sessionId);
    for (const line of lines) {
      insert.run(
        sessionId,
        line.line_index,
        line.author_name,
        line.content,
        line.timestamp_ms,
        line.source_type,
        JSON.stringify(line.source_ids),
        now
      );
    }
  });

  runAll();
}

function hasBronzeTranscript(sessionId: string): boolean {
  const db = getDb();
  const row = db
    .prepare(`SELECT 1 FROM bronze_transcript WHERE session_id = ? LIMIT 1`)
    .get(sessionId) as any;
  return !!row;
}

// ── Core: Write human-readable file ─────────────────────────────────────────

function saveTranscriptFile(
  label: string,
  session: OfficialSessionRow,
  lines: BronzeLine[]
): string {
  const outDir = path.resolve("data", "transcripts");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const filename = `transcript_${label}.txt`;
  const filepath = path.join(outDir, filename);

  const header = [
    `# Transcript: ${label}`,
    `# Session ID: ${session.session_id}`,
    `# Source: ${session.source}`,
    `# Lines: ${lines.length}`,
    `# Compiled: ${new Date().toISOString()}`,
    "",
  ].join("\n");

  const body = lines
    .map((l) => `[L${l.line_index}] ${l.author_name}: ${l.content}`)
    .join("\n");

  fs.writeFileSync(filepath, header + body + "\n", "utf-8");
  return filepath;
}

// ── Core: Compile one session ─────────────────────────────────────────────────

export function compileTranscript(
  session: OfficialSessionRow,
  force: boolean = false
): { linesWritten: number; skipped: boolean } {
  const { session_id, label, source } = session;

  if (!force && hasBronzeTranscript(session_id)) {
    return { linesWritten: 0, skipped: true };
  }

  const rawEntries = loadRawEntries(session_id);
  if (rawEntries.length === 0) {
    console.warn(`  ⚠️  ${label}: no primary ledger entries found, skipping.`);
    return { linesWritten: 0, skipped: true };
  }

  const isLive = source === "live";
  const lines = isLive ? fuseVoiceEntries(rawEntries) : mapIngestEntries(rawEntries);

  const fusedCount = isLive
    ? rawEntries.length - lines.length  // how many entries were absorbed by fusion
    : 0;

  upsertBronzeTranscript(session_id, lines);
  const filepath = saveTranscriptFile(label, session, lines);

  const fuseNote = isLive && fusedCount > 0
    ? ` (${rawEntries.length} raw → ${lines.length} lines, ${fusedCount} voice entries fused)`
    : ` (${lines.length} lines)`;

  console.log(`  ✅ ${label}${fuseNote} → ${filepath}`);
  return { linesWritten: lines.length, skipped: false };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function parseArgs(): {
  mode: "all" | "session" | null;
  sessionLabel: string | null;
  force: boolean;
} {
  const args = process.argv.slice(2);
  let mode: "all" | "session" | null = null;
  let sessionLabel: string | null = null;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--all") {
      mode = "all";
    } else if (args[i] === "--session" && args[i + 1]) {
      mode = "session";
      sessionLabel = args[i + 1];
      i++;
    } else if (args[i] === "--force") {
      force = true;
    }
  }

  return { mode, sessionLabel, force };
}

async function main(): Promise<void> {
  const { mode, sessionLabel, force } = parseArgs();

  if (!mode) {
    console.error(
      "Usage:\n" +
        "  compile-transcripts --all [--force]\n" +
        "  compile-transcripts --session <LABEL> [--force]"
    );
    process.exit(1);
  }

  const db = getDb();

  if (mode === "session") {
    if (!sessionLabel) {
      console.error("--session requires a label argument, e.g. --session C2E10");
      process.exit(1);
    }

    const session = getOfficialSessionByLabel(db, sessionLabel);
    if (!session) {
      console.error(`Session not found or is a test session: ${sessionLabel}`);
      process.exit(1);
    }

    console.log(`\nCompiling transcript for ${session.label} (${session.source})...`);
    const result = compileTranscript(session, force);

    if (result.skipped) {
      console.log(`  ⏭  ${session.label}: already compiled (use --force to recompile).`);
    }
    return;
  }

  // --all
  const labels = getOfficialSessionLabels(db);
  if (labels.length === 0) {
    console.log("No official sessions found.");
    return;
  }

  console.log(`\nFound ${labels.length} official session(s). Compiling bronze transcripts...\n`);

  let compiled = 0;
  let skipped = 0;
  let failed = 0;

  for (const label of labels) {
    const session = getOfficialSessionByLabel(db, label)!;
    try {
      const result = compileTranscript(session, force);
      if (result.skipped) {
        console.log(`  ⏭  ${label}: already compiled.`);
        skipped++;
      } else {
        compiled++;
      }
    } catch (err: any) {
      console.error(`  ❌ ${label}: ${err.message ?? err}`);
      failed++;
    }
  }

  console.log(
    `\nDone. Compiled: ${compiled}, Skipped: ${skipped}, Failed: ${failed}`
  );
  if (failed > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("Fatal:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
