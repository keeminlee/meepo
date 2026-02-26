import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import Database from "better-sqlite3";
import type { RegimeChunk } from "../causal/pruneRegimes.js";
import { getCausalEligibilityMasks } from "../causal/eligibility/getCausalEligibilityMasks.js";
import { getSilverEligibilityMasks } from "../silver/seq/getSilverEligibilityMasks.js";

const CAMPAIGN = "homebrew_campaign_2";
const SESSION_LABEL = "C2E20";
const MAX_MISMATCH_DIAGNOSTICS = 20;
const CAMPAIGN_DB_PATH = path.join(process.cwd(), "data", "campaigns", CAMPAIGN, "db.sqlite");
const HAS_CAMPAIGN_SNAPSHOT = fs.existsSync(CAMPAIGN_DB_PATH);

type TranscriptEntry = {
  line_index: number;
  author_name: string;
  content: string;
  timestamp_ms: number;
  source_type?: string;
  source_ids?: string[];
};

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function loadCampaignContext() {
  const db = new Database(CAMPAIGN_DB_PATH, { readonly: true });
  const session = getSessionByLabel(db, SESSION_LABEL);
  const transcript = loadBronzeTranscript(db, session.session_id);
  const chunks = loadScaffoldChunks(db, session.session_id);

  return {
    db,
    transcript,
    chunks,
  };
}

function loadBronzeTranscript(db: any, sessionId: string): TranscriptEntry[] {
  const rows = db
    .prepare(
      `SELECT line_index, author_name, content, timestamp_ms, source_type, source_ids
       FROM bronze_transcript
       WHERE session_id = ?
       ORDER BY line_index ASC`,
    )
    .all(sessionId) as Array<{
      line_index: number;
      author_name: string;
      content: string;
      timestamp_ms: number;
      source_type: string;
      source_ids: string;
    }>;

  if (rows.length === 0) {
    throw new Error(`No bronze transcript found for session ${sessionId} in campaign ${CAMPAIGN}`);
  }

  return rows.map((row, idx) => ({
    line_index: idx,
    author_name: row.author_name,
    content: row.content,
    timestamp_ms: row.timestamp_ms,
    source_type: row.source_type,
    source_ids: JSON.parse(row.source_ids),
  }));
}

function getSessionByLabel(db: any, sessionLabel: string): { session_id: string; label: string } {
  const row = db
    .prepare(
      `SELECT session_id, label
       FROM sessions
       WHERE label = ?
       ORDER BY created_at_ms DESC
       LIMIT 1`,
    )
    .get(sessionLabel) as { session_id: string; label: string } | undefined;

  if (!row) {
    throw new Error(`Session not found in campaign DB (${CAMPAIGN}): ${sessionLabel}`);
  }

  return row;
}

function loadScaffoldChunks(db: any, sessionId: string): RegimeChunk[] {
  const scaffold = db
    .prepare(
      `SELECT event_id, start_index, end_index
       FROM event_scaffold
       WHERE session_id = ?
       ORDER BY start_index ASC`,
    )
    .all(sessionId) as Array<{ event_id: string; start_index: number; end_index: number }>;

  const events = db
    .prepare(
      `SELECT id, start_index, end_index, is_ooc
       FROM events
       WHERE session_id = ?`,
    )
    .all(sessionId) as Array<{ id: string; start_index: number; end_index: number; is_ooc: number }>;

  if (scaffold.length === 0) {
    return events
      .slice()
      .sort((a, b) => (a.start_index - b.start_index) || (a.end_index - b.end_index))
      .map((row, idx) => ({
        chunk_id: row.id,
        chunk_index: idx,
        start_index: row.start_index,
        end_index: row.end_index,
        is_ooc: row.is_ooc === 1,
      }));
  }

  const oocMap = new Map(events.map((entry) => [`${entry.start_index}:${entry.end_index}`, entry.is_ooc === 1]));

  return scaffold.map((row, idx) => ({
    chunk_id: row.event_id,
    chunk_index: idx,
    start_index: row.start_index,
    end_index: row.end_index,
    is_ooc: oocMap.get(`${row.start_index}:${row.end_index}`),
  }));
}

function findMaskMismatches(a: boolean[], b: boolean[]): number[] {
  const maxLength = Math.max(a.length, b.length);
  const mismatches: number[] = [];

  for (let i = 0; i < maxLength; i++) {
    if ((a[i] ?? false) !== (b[i] ?? false)) {
      mismatches.push(i);
    }
  }

  return mismatches;
}

function buildMismatchDiagnostics(
  label: string,
  mismatchIndices: number[],
  transcript: TranscriptEntry[],
  causalMask: boolean[],
  silverMask: boolean[],
): string {
  const samples = mismatchIndices.slice(0, MAX_MISMATCH_DIAGNOSTICS);
  const lines = samples.map((index) => {
    const row = transcript[index];
    return [
      `index=${index}`,
      `causal=${causalMask[index] ?? false}`,
      `silver=${silverMask[index] ?? false}`,
      `author=${row?.author_name ?? "(missing)"}`,
      `content=${row?.content ?? "(missing)"}`,
    ].join(" | ");
  });

  return `${label} mismatches=${mismatchIndices.length}\n${lines.join("\n")}`;
}

test.skipIf(!HAS_CAMPAIGN_SNAPSHOT)("C2E20 prune eligibility masks are bit-identical between causal and silver wrappers", async () => {
  const { db, transcript, chunks } = await loadCampaignContext();
  try {
    expect(transcript.length).toBeGreaterThan(0);

    const causal = getCausalEligibilityMasks(transcript, chunks, { combat_mode: "prune" });
    const silver = getSilverEligibilityMasks(transcript, chunks, { combat_mode: "prune" });

    expect(causal.length).toBe(transcript.length);
    expect(silver.length).toBe(transcript.length);

    const oocMismatches = findMaskMismatches(causal.is_ooc, silver.is_ooc);
    if (oocMismatches.length > 0) {
      throw new Error(buildMismatchDiagnostics("is_ooc", oocMismatches, transcript, causal.is_ooc, silver.is_ooc));
    }

    const combatMismatches = findMaskMismatches(causal.is_combat, silver.is_combat);
    if (combatMismatches.length > 0) {
      throw new Error(buildMismatchDiagnostics("is_combat", combatMismatches, transcript, causal.is_combat, silver.is_combat));
    }
  } finally {
    db.close();
  }
});

test.skipIf(!HAS_CAMPAIGN_SNAPSHOT)("C2E20 prune eligibility masks are deterministic across 3 runs", async () => {
  const { db, transcript, chunks } = await loadCampaignContext();
  try {
    const causalHashes: string[] = [];
    const silverHashes: string[] = [];

    for (let i = 0; i < 3; i++) {
      const causal = getCausalEligibilityMasks(transcript, chunks, { combat_mode: "prune" });
      const silver = getSilverEligibilityMasks(transcript, chunks, { combat_mode: "prune" });

      causalHashes.push(stableHash(causal));
      silverHashes.push(stableHash(silver));
    }

    expect(new Set(causalHashes).size).toBe(1);
    expect(new Set(silverHashes).size).toBe(1);
  } finally {
    db.close();
  }
});
