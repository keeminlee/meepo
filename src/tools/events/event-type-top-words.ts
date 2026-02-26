/**
 * event-type-top-words.ts: Top-K word frequency per event_type (session/all)
 *
 * Purpose:
 * - Analyze LLM-labeled events to inform deterministic preclassification heuristics.
 * - Group events by event_type and compute top-K words from transcript spans.
 *
 * Usage:
 *   npx tsx src/tools/event-type-top-words.ts
 *   npx tsx src/tools/event-type-top-words.ts --session <SESSION_LABEL> [--k 5] [--includeOoc]
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../../db.js";
import { buildTranscript } from "../../ledger/transcripts.js";

type Args = {
  sessionLabel: string | null;
  k: number;
  includeOoc: boolean;
  minLen: number;
};

const DEFAULT_K = 5;
const DEFAULT_MIN_LEN = 3;

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "you", "your", "from", "they", "their",
  "them", "then", "there", "have", "has", "had", "was", "were", "are", "but", "not",
  "what", "when", "where", "who", "why", "how", "into", "onto", "over", "under", "out",
  "about", "just", "like", "also", "here", "yeah", "okay", "ok", "got", "get", "gets",
  "i", "im", "i'm", "me", "my", "mine", "we", "us", "our", "ours",
  "he", "him", "his", "she", "her", "hers", "it", "its", "they", "them", "their",
  "a", "an", "of", "to", "in", "on", "at", "as", "is", "be", "by", "or", "so",
  "if", "no", "yes", "do", "did", "does", "dont", "don't", "cant", "can't", "could",
  "would", "should", "will", "shall", "may", "might", "can", "let", "lets", "let's",
  "now", "then", "than", "too", "very", "more", "most", "some", "any", "all",
]);

function parseArgs(): Args {
  const args: Record<string, string | boolean> = {};
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = process.argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }

  return {
    sessionLabel: (args.session as string) || null,
    k: parseInt((args.k as string) || String(DEFAULT_K), 10),
    includeOoc: args.includeOoc === true || args.includeOoc === "true",
    minLen: parseInt((args.minLen as string) || String(DEFAULT_MIN_LEN), 10),
  };
}

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

function loadEventsBySession(sessionId: string) {
  const db = getDb();
  return db
    .prepare(
      `SELECT session_id, event_type, start_index, end_index, is_ooc
       FROM events
       WHERE session_id = ?
       ORDER BY start_index ASC`
    )
    .all(sessionId) as Array<{
    session_id: string;
    event_type: string;
    start_index: number;
    end_index: number;
    is_ooc: number;
  }>;
}

function loadAllEvents() {
  const db = getDb();
  return db
    .prepare(
      `SELECT session_id, event_type, start_index, end_index, is_ooc
       FROM events
       ORDER BY session_id, start_index ASC`
    )
    .all() as Array<{
    session_id: string;
    event_type: string;
    start_index: number;
    end_index: number;
    is_ooc: number;
  }>;
}

function normalizeToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/[^a-z0-9']/g, "")
    .replace(/'+/g, "'")
    .replace(/^'+|'+$/g, "");
}

function tokenize(text: string, minLen: number): string[] {
  const rawTokens = text.split(/\s+/g);
  const tokens: string[] = [];

  for (const raw of rawTokens) {
    const t = normalizeToken(raw);
    if (!t) continue;
    if (t.length < minLen) continue;
    if (STOP_WORDS.has(t)) continue;
    if (/^\d+$/.test(t)) continue;
    tokens.push(t);
  }

  return tokens;
}

function sanitizeLabel(label: string): string {
  return label.replace(/[^a-z0-9-_]+/gi, "_").replace(/^_+|_+$/g, "");
}

function main() {
  const args = parseArgs();

  const isAllSessions = !args.sessionLabel;
  const events = isAllSessions
    ? loadAllEvents()
    : loadEventsBySession(getSession(args.sessionLabel as string).session_id);

  if (events.length === 0) {
    console.log("No events found for the specified scope.");
    return;
  }

  const transcriptCache = new Map<string, Array<{ index: number; content: string }>>();

  const byType = new Map<string, Map<string, number>>();
  const totalsByType = new Map<string, number>();
  const overallCounts = new Map<string, number>();
  let overallTotalTokens = 0;

  for (const event of events) {
    if (!args.includeOoc && event.is_ooc === 1) {
      continue;
    }

    if (!transcriptCache.has(event.session_id)) {
      const transcriptEntries = buildTranscript(event.session_id, true);
      transcriptCache.set(
        event.session_id,
        transcriptEntries.map((e) => ({ index: e.line_index, content: e.content }))
      );
    }

    const entries = transcriptCache.get(event.session_id)!;

    const wordCounts = byType.get(event.event_type) || new Map<string, number>();
    byType.set(event.event_type, wordCounts);

    for (let i = event.start_index; i <= event.end_index && i < entries.length; i++) {
      const tokens = tokenize(entries[i].content, args.minLen);
      for (const token of tokens) {
        wordCounts.set(token, (wordCounts.get(token) || 0) + 1);
        totalsByType.set(event.event_type, (totalsByType.get(event.event_type) || 0) + 1);
        overallCounts.set(token, (overallCounts.get(token) || 0) + 1);
        overallTotalTokens++;
      }
    }
  }

  console.log(`\nScope: ${isAllSessions ? "ALL SESSIONS" : args.sessionLabel}`);
  console.log(`Events scanned: ${events.length}`);
  console.log(`Include OOC: ${args.includeOoc ? "yes" : "no"}`);
  console.log(`Top-K: ${args.k} | Min token length: ${args.minLen}\n`);

  const eventTypes = Array.from(byType.keys()).sort();
  const topTokensByType = new Map<string, string[]>();
  const unionTokens = new Set<string>();

  for (const eventType of eventTypes) {
    const wordCounts = byType.get(eventType)!;
    const totalTokens = totalsByType.get(eventType) || 0;

    const ranked = Array.from(wordCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, args.k);

    topTokensByType.set(eventType, ranked.map(([word]) => word));
    for (const [word] of ranked) {
      unionTokens.add(word);
    }

    console.log(`=== ${eventType.toUpperCase()} (total tokens: ${totalTokens}) ===`);
    if (ranked.length === 0) {
      console.log("  [no tokens]");
    } else {
      for (const [word, count] of ranked) {
        console.log(`  ${word.padEnd(16)} ${count}`);
      }
    }
    console.log("");
  }

  const unionList = Array.from(unionTokens).sort();
  if (unionList.length === 0) {
    console.log("No tokens found for table output.");
    return;
  }

  const colWidths = [
    Math.max("event_type".length, ...eventTypes.map((t) => t.length)),
    ...unionList.map((t) => Math.max(t.length, 6)),
  ];

  const header = ["event_type", ...unionList]
    .map((label, idx) => label.padEnd(colWidths[idx]))
    .join(" | ");
  const divider = colWidths.map((w) => "-".repeat(w)).join("-+-");

  console.log("=== EVENT TYPE x TOP TOKENS TABLE (NORMALIZED LIFT) ===");
  console.log(header);
  console.log(divider);

  const csvRows: string[] = [];
  csvRows.push(["event_type", ...unionList].join(","));

  for (const eventType of eventTypes) {
    const wordCounts = byType.get(eventType)!;
    const totalTokens = totalsByType.get(eventType) || 0;
    const row = [
      eventType.padEnd(colWidths[0]),
      ...unionList.map((token, idx) => {
        const count = wordCounts.get(token) || 0;
        const overallCount = overallCounts.get(token) || 0;
        const marginal = totalTokens > 0 ? count / totalTokens : 0;
        const overall = overallTotalTokens > 0 ? overallCount / overallTotalTokens : 0;
        const lift = overall > 0 ? marginal / overall : 0;
        return lift.toFixed(4).padEnd(colWidths[idx + 1]);
      }),
    ].join(" | ");
    console.log(row);

    const csvRow = [
      eventType,
      ...unionList.map((token) => {
        const count = wordCounts.get(token) || 0;
        const overallCount = overallCounts.get(token) || 0;
        const marginal = totalTokens > 0 ? count / totalTokens : 0;
        const overall = overallTotalTokens > 0 ? overallCount / overallTotalTokens : 0;
        const lift = overall > 0 ? marginal / overall : 0;
        return lift.toFixed(6);
      }),
    ].join(",");
    csvRows.push(csvRow);
  }

  const scopeLabel = isAllSessions ? "ALL" : sanitizeLabel(String(args.sessionLabel));
  const eventsDir = path.join(process.cwd(), "data", "events");
  if (!fs.existsSync(eventsDir)) {
    fs.mkdirSync(eventsDir, { recursive: true });
  }

  const csvPath = path.join(eventsDir, `event_type_top_words_norm_${scopeLabel}.csv`);
  fs.writeFileSync(csvPath, csvRows.join("\n"), "utf-8");
  console.log(`\nCSV exported: ${csvPath}`);
}

main();
