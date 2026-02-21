/**
 * event-type-feature-metrics.ts: Event-type feature metrics (CSV)
 *
 * Computes per-event_type metrics across all sessions or a specific session.
 *
 * Metrics:
 * 1) future_cues_per_1k_tokens
 *    - Count tokens: will, gonna, should
 *    - Count phrase: going to
 * 2) ed_ratio
 *    - Count tokens ending with "ed" (len >= 4)
 * 3) irregular_past_per_1k_tokens
 *    - Count tokens: was, were, had, did, said, went, saw, got, took, came, found, knew
 * 4) dm_ratio
 *    - DM tokens / total tokens (DM detected from transcript speaker names)
 * 5) alternation_rate
 *    - speaker_switches / total_lines
 * 6) combat_density
 *    - combat_tokens / total_tokens
 *
 * Usage:
 *   npx tsx src/tools/event-type-feature-metrics.ts
 *   npx tsx src/tools/event-type-feature-metrics.ts --session C2E20
 *   npx tsx src/tools/event-type-feature-metrics.ts --excludeOoc
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../../db.js";
import { buildTranscript } from "../../ledger/transcripts.js";
import { buildDmNameSet, detectDmSpeaker, isDmSpeaker } from "../../ledger/scaffoldSpeaker.js";

type Args = {
  sessionLabel: string | null;
  includeOoc: boolean;
};

type EventRow = {
  session_id: string;
  event_type: string;
  start_index: number;
  end_index: number;
  is_ooc: number;
};

type Metrics = {
  total_tokens: number;
  total_lines: number;
  future_cues: number;
  ed_count: number;
  irregular_past: number;
  dm_tokens: number;
  speaker_switches: number;
  combat_tokens: number;
};

type EventMetrics = {
  future_per_1k: number;
  ed_ratio: number;
  irregular_per_1k: number;
  dm_ratio: number;
  alternation_rate: number;
  combat_density: number;
};

type MetricStats = {
  count: number;
  sum: number;
  sumSq: number;
};

type EventTypeStats = {
  events: number;
  future_per_1k: MetricStats;
  ed_ratio: MetricStats;
  irregular_per_1k: MetricStats;
  dm_ratio: MetricStats;
  alternation_rate: MetricStats;
  combat_density: MetricStats;
};

const FUTURE_TOKENS = new Set(["will", "gonna", "should"]);
const IRREGULAR_PAST = new Set([
  "was", "were", "had", "did", "said", "went", "saw", "got", "took", "came", "found", "knew",
]);
const COMBAT_TOKENS = new Set([
  "initiative", "round", "turn", "damage", "attack", "ac", "hit", "miss", "roll", "saving", "spell", "bonus",
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

  const excludeOoc = args.excludeOoc === true || args.excludeOoc === "true";

  return {
    sessionLabel: (args.session as string) || null,
    includeOoc: !excludeOoc,
  };
}

function sanitizeLabel(label: string): string {
  return label.replace(/[^a-z0-9-_]+/gi, "_").replace(/^_+|_+$/g, "");
}

function normalizeToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, "")
    .replace(/'+/g, "'")
    .replace(/^'+|'+$/g, "");
}

function tokenizeSimple(text: string): string[] {
  return text
    .split(/\s+/g)
    .map((t) => normalizeToken(t))
    .filter((t) => t.length > 0);
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

function loadEventsBySession(sessionId: string): EventRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT session_id, event_type, start_index, end_index, is_ooc
       FROM events
       WHERE session_id = ?
       ORDER BY start_index ASC`
    )
    .all(sessionId) as EventRow[];
}

function loadAllEvents(): EventRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT session_id, event_type, start_index, end_index, is_ooc
       FROM events
       ORDER BY session_id, start_index ASC`
    )
    .all() as EventRow[];
}

function initMetricStats(): MetricStats {
  return { count: 0, sum: 0, sumSq: 0 };
}

function initEventTypeStats(): EventTypeStats {
  return {
    events: 0,
    future_per_1k: initMetricStats(),
    ed_ratio: initMetricStats(),
    irregular_per_1k: initMetricStats(),
    dm_ratio: initMetricStats(),
    alternation_rate: initMetricStats(),
    combat_density: initMetricStats(),
  };
}

function ensureEventTypeStats(map: Map<string, EventTypeStats>, eventType: string): EventTypeStats {
  if (!map.has(eventType)) {
    map.set(eventType, initEventTypeStats());
  }
  return map.get(eventType)!;
}

function pushStat(stat: MetricStats, value: number): void {
  stat.count += 1;
  stat.sum += value;
  stat.sumSq += value * value;
}

function finalizeStat(stat: MetricStats): { mean: number; variance: number } {
  if (stat.count === 0) {
    return { mean: 0, variance: 0 };
  }
  const mean = stat.sum / stat.count;
  const variance = stat.sumSq / stat.count - mean * mean;
  return { mean, variance: Math.max(0, variance) };
}

function main() {
  const args = parseArgs();
  const isAllSessions = !args.sessionLabel;
  const scopedSessionId = isAllSessions ? null : getSession(args.sessionLabel!).session_id;

  const events = isAllSessions
    ? loadAllEvents()
    : loadEventsBySession(scopedSessionId);

  if (events.length === 0) {
    console.log("No events found for the specified scope.");
    return;
  }

  const transcriptCache = new Map<string, Array<{ index: number; speaker: string; content: string }>>();
  const dmNameCache = new Map<string, Set<string>>();

  const statsByType = new Map<string, EventTypeStats>();
  const overallStats = initEventTypeStats();

  for (const event of events) {
    if (!args.includeOoc && event.is_ooc === 1) {
      continue;
    }

    if (!transcriptCache.has(event.session_id)) {
      const transcriptEntries = buildTranscript(event.session_id, true);
      transcriptCache.set(
        event.session_id,
        transcriptEntries.map((e) => ({
          index: e.line_index,
          speaker: e.author_name,
          content: e.content,
        }))
      );

      const speakerNames = transcriptEntries.map((e) => e.author_name);
      const detectedDm = detectDmSpeaker(speakerNames);
      dmNameCache.set(event.session_id, buildDmNameSet(detectedDm));
    }

    const entries = transcriptCache.get(event.session_id)!;
    const dmNames = dmNameCache.get(event.session_id)!;

    const metrics: Metrics = {
      total_tokens: 0,
      total_lines: 0,
      future_cues: 0,
      ed_count: 0,
      irregular_past: 0,
      dm_tokens: 0,
      speaker_switches: 0,
      combat_tokens: 0,
    };

    let prevSpeaker: string | null = null;
    let prevIsDm: boolean | null = null;
    for (let i = event.start_index; i <= event.end_index && i < entries.length; i++) {
      const entry = entries[i];
      const tokens = tokenizeSimple(entry.content);

      metrics.total_lines++;
      
      const isDm = isDmSpeaker(entry.speaker, dmNames);
      
      // PC-to-PC handoff: non-DM speaker followed by different non-DM speaker
      if (
        prevSpeaker !== null &&
        entry.speaker !== prevSpeaker &&
        !isDm &&
        prevIsDm === false
      ) {
        metrics.speaker_switches++;
      }
      
      prevSpeaker = entry.speaker;
      prevIsDm = isDm;
      for (let t = 0; t < tokens.length; t++) {
        const token = tokens[t];
        metrics.total_tokens++;

        if (isDm) {
          metrics.dm_tokens++;
        }

        if (FUTURE_TOKENS.has(token)) {
          metrics.future_cues++;
        }

        if (token === "going" && tokens[t + 1] === "to") {
          metrics.future_cues++;
        }

        if (token.length >= 4 && token.endsWith("ed")) {
          metrics.ed_count++;
        }

        if (IRREGULAR_PAST.has(token)) {
          metrics.irregular_past++;
        }

        if (COMBAT_TOKENS.has(token)) {
          metrics.combat_tokens++;
        }
      }
    }

    const totalTokens = metrics.total_tokens;
    const totalLines = metrics.total_lines;
    const eventMetrics: EventMetrics = {
      future_per_1k: totalTokens > 0 ? (metrics.future_cues / totalTokens) * 1000 : 0,
      ed_ratio: totalTokens > 0 ? metrics.ed_count / totalTokens : 0,
      irregular_per_1k: totalTokens > 0 ? (metrics.irregular_past / totalTokens) * 1000 : 0,
      dm_ratio: totalTokens > 0 ? metrics.dm_tokens / totalTokens : 0,
      alternation_rate: totalLines > 0 ? metrics.speaker_switches / totalLines : 0,
      combat_density: totalTokens > 0 ? metrics.combat_tokens / totalTokens : 0,
    };

    const typeStats = ensureEventTypeStats(statsByType, event.event_type);
    typeStats.events += 1;
    pushStat(typeStats.future_per_1k, eventMetrics.future_per_1k);
    pushStat(typeStats.ed_ratio, eventMetrics.ed_ratio);
    pushStat(typeStats.irregular_per_1k, eventMetrics.irregular_per_1k);
    pushStat(typeStats.dm_ratio, eventMetrics.dm_ratio);
    pushStat(typeStats.alternation_rate, eventMetrics.alternation_rate);
    pushStat(typeStats.combat_density, eventMetrics.combat_density);

    overallStats.events += 1;
    pushStat(overallStats.future_per_1k, eventMetrics.future_per_1k);
    pushStat(overallStats.ed_ratio, eventMetrics.ed_ratio);
    pushStat(overallStats.irregular_per_1k, eventMetrics.irregular_per_1k);
    pushStat(overallStats.dm_ratio, eventMetrics.dm_ratio);
    pushStat(overallStats.alternation_rate, eventMetrics.alternation_rate);
    pushStat(overallStats.combat_density, eventMetrics.combat_density);
  }

  const eventTypes = Array.from(statsByType.keys()).sort();
  const overallFuture = finalizeStat(overallStats.future_per_1k).mean;
  const overallEd = finalizeStat(overallStats.ed_ratio).mean;
  const overallIrregular = finalizeStat(overallStats.irregular_per_1k).mean;
  const overallDm = finalizeStat(overallStats.dm_ratio).mean;
  const overallAlt = finalizeStat(overallStats.alternation_rate).mean;
  const overallCombat = finalizeStat(overallStats.combat_density).mean;

  const rows: string[] = [];
  rows.push([
    "event_type",
    "event_count",
    "future_cues_per_1k_mean",
    "future_cues_per_1k_var",
    "future_cues_per_1k_lift",
    "ed_ratio_mean",
    "ed_ratio_var",
    "ed_ratio_lift",
    "irregular_past_per_1k_mean",
    "irregular_past_per_1k_var",
    "irregular_past_per_1k_lift",
    "dm_ratio_mean",
    "dm_ratio_var",
    "dm_ratio_lift",
    "alternation_rate_mean",
    "alternation_rate_var",
    "alternation_rate_lift",
    "combat_density_mean",
    "combat_density_var",
    "combat_density_lift",
  ].join(","));

  for (const eventType of eventTypes) {
    const stats = statsByType.get(eventType)!;
    const future = finalizeStat(stats.future_per_1k);
    const ed = finalizeStat(stats.ed_ratio);
    const irregular = finalizeStat(stats.irregular_per_1k);
    const dm = finalizeStat(stats.dm_ratio);
    const alt = finalizeStat(stats.alternation_rate);
    const combat = finalizeStat(stats.combat_density);

    const futureLift = overallFuture > 0 ? future.mean / overallFuture : 0;
    const edLift = overallEd > 0 ? ed.mean / overallEd : 0;
    const irregularLift = overallIrregular > 0 ? irregular.mean / overallIrregular : 0;
    const dmLift = overallDm > 0 ? dm.mean / overallDm : 0;
    const altLift = overallAlt > 0 ? alt.mean / overallAlt : 0;
    const combatLift = overallCombat > 0 ? combat.mean / overallCombat : 0;

    rows.push([
      eventType,
      String(stats.events),
      future.mean.toFixed(6),
      future.variance.toFixed(6),
      futureLift.toFixed(6),
      ed.mean.toFixed(6),
      ed.variance.toFixed(6),
      edLift.toFixed(6),
      irregular.mean.toFixed(6),
      irregular.variance.toFixed(6),
      irregularLift.toFixed(6),
      dm.mean.toFixed(6),
      dm.variance.toFixed(6),
      dmLift.toFixed(6),
      alt.mean.toFixed(6),
      alt.variance.toFixed(6),
      altLift.toFixed(6),
      combat.mean.toFixed(6),
      combat.variance.toFixed(6),
      combatLift.toFixed(6),
    ].join(","));
  }

  const scopeLabel = isAllSessions ? "ALL" : sanitizeLabel(String(args.sessionLabel));
  const eventsDir = path.join(process.cwd(), "data", "events");
  if (!fs.existsSync(eventsDir)) {
    fs.mkdirSync(eventsDir, { recursive: true });
  }

  const csvPath = path.join(eventsDir, `event_type_feature_metrics_${scopeLabel}.csv`);
  fs.writeFileSync(csvPath, rows.join("\n"), "utf-8");

  console.log(`CSV exported: ${csvPath}`);
  console.log(`Scope: ${isAllSessions ? "ALL SESSIONS" : args.sessionLabel}`);
  console.log(`Include OOC: ${args.includeOoc ? "yes" : "no"}`);
  console.log(`Event types: ${eventTypes.length}`);
}

main();
