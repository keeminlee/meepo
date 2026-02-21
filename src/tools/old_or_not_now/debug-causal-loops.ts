/**
 * debug-causal-loops.ts: Debug legacy causal loop extraction.
 * 
 * This is the legacy (Graph v0.5) causal inference system using regime-masked chunks
 * and single-best-match scoring. Kept for architectural comparison and backup.
 * 
 * Newer intent graph system recommended for new projects.
 * See debug-intent-graph.ts for the primary analysis tool.
 * 
 * CLI:
 *   npx tsx src/tools/debug-causal-loops.ts --session C2E20 [--printMasks] [--report]
 *   npx tsx src/tools/debug-causal-loops.ts --all [--report]
 * 
 * Flags:
 *   --session LABEL           Analyze single session
 *   --all                     Process all official sessions
 *   --force                   Recompute even if cached
 *   --report                  Print human-readable summary
 *   --printMasks              Display OOC and combat mask boundaries
 *   --printMaskLines N        Show N sample lines from each mask span
 *   --noMasks                 Disable all masking filters
 *   --noOocMasks              Disable OOC soft and hard masks
 *   --noCombatMasks           Disable combat masks
 *   --includeOocSoft          Include OOC soft-masked lines (normally filtered)
 *   --oocAlt N                OOC soft threshold, alternation rate (default auto)
 *   --combatDensity N         Combat threshold, token density (default auto)
 *   --combatLow N             Combat threshold, low density cutoff (default auto)
 *   --debugCombat             Print combat detection details
 * 
 * Output:
 *   - Total causal loops extracted (intent → consequence pairs)
 *   - Breakdown by actor
 *   - Resolved rate: loops with actual consequences vs unresolved
 *   - Orphan rate: DM consequences not attached to any loop
 *   - PC line coverage: loops per 100 PC lines
 *   - Sample loops and bottom-confidence loops
 *   - OOC/combat mask boundaries (if --printMasks)
 * 
 * Database:
 *   Writes to causal_loops table with full intent/consequence details,
 *   confidence scores, and roll/outcome information.
 * 
 * Note: For new analysis, use intent-graph system (debug-intent-graph.ts).
 *       This tool retained for legacy compatibility and architectural reference.
 * 
 * Returns: 0 on success, 1 on error
 */

import "dotenv/config";
import { getDb } from "../db.js";
import { buildTranscript } from "../ledger/transcripts.js";
import { loadRegistry } from "../registry/loadRegistry.js";
import {
  calculateCombatStats,
  calculatePlayerAlternationRate,
  generateRegimeMasks,
  type RegimeChunk,
  type RegimeMaskOptions,
} from "../causal/pruneRegimes.js";
import {
  extractCausalLoopsFromChunks,
  type PcActor,
} from "../causal/extractCausalLoops.js";
import { detectConsequence } from "../causal/detectConsequence.js";
import { buildDmNameSet, detectDmSpeaker, isDmSpeaker } from "../ledger/scaffoldSpeaker.js";

function parseArgs() {
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
    all: args.all === true,
    includeOocSoft: args.includeOocSoft === true,
    printMasks: args.printMasks === true,
    printMaskLines: args.printMaskLines ? Number(args.printMaskLines) : 0,
    noMasks: args.noMasks === true,
    noOocMasks: args.noOocMasks === true,
    noCombatMasks: args.noCombatMasks === true,
    debugCombat: args.debugCombat === true,
    alternationThreshold: args.oocAlt ? Number(args.oocAlt) : undefined,
    combatDensityThreshold: args.combatDensity ? Number(args.combatDensity) : undefined,
    combatDensityLow: args.combatLow ? Number(args.combatLow) : undefined,
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

function loadAllSessions(): Array<{ session_id: string; label: string | null }> {
  const db = getDb();
  return db
    .prepare("SELECT session_id, label FROM sessions ORDER BY created_at_ms ASC")
    .all() as Array<{ session_id: string; label: string | null }>;
}

function loadScaffoldChunks(sessionId: string): RegimeChunk[] {
  const db = getDb();
  const scaffold = db
    .prepare(
      `SELECT event_id, start_index, end_index
       FROM event_scaffold
       WHERE session_id = ?
       ORDER BY start_index ASC`
    )
    .all(sessionId) as Array<{ event_id: string; start_index: number; end_index: number }>;

  const events = db
    .prepare(
      `SELECT start_index, end_index, is_ooc
       FROM events
       WHERE session_id = ?`
    )
    .all(sessionId) as Array<{ start_index: number; end_index: number; is_ooc: number }>;

  const oocMap = new Map<string, boolean>();
  for (const e of events) {
    oocMap.set(`${e.start_index}:${e.end_index}`, e.is_ooc === 1);
  }

  return scaffold.map((row, idx) => ({
    chunk_id: row.event_id,
    chunk_index: idx,
    start_index: row.start_index,
    end_index: row.end_index,
    is_ooc: oocMap.get(`${row.start_index}:${row.end_index}`),
  }));
}

function loadPcActors(): PcActor[] {
  const registry = loadRegistry();
  return registry.characters
    .filter((c) => c.type === "pc")
    .map((pc) => ({
      id: pc.id,
      canonical_name: pc.canonical_name,
      aliases: pc.aliases ?? [],
    }));
}

function normalizeName(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "")
    .replace(/\s+/g, " ");
}

function buildActorNameSet(actor: PcActor): string[] {
  const names = [actor.canonical_name, ...(actor.aliases ?? [])];
  return names.map((name) => normalizeName(name)).filter(Boolean);
}

function matchPcSpeaker(speaker: string, actors: PcActor[]): PcActor | null {
  const normSpeaker = normalizeName(speaker);
  if (!normSpeaker) return null;

  let best: PcActor | null = null;
  let bestLen = 0;

  for (const actor of actors) {
    const names = buildActorNameSet(actor);
    for (const name of names) {
      if (!name) continue;
      if (normSpeaker === name || normSpeaker.includes(name)) {
        if (name.length > bestLen) {
          best = actor;
          bestLen = name.length;
        }
      }
    }
  }

  return best;
}

function isLineMasked(
  lineIndex: number,
  masks: ReturnType<typeof generateRegimeMasks>,
  includeOocSoft: boolean
): boolean {
  for (const span of masks.oocHard) {
    if (lineIndex >= span.start_index && lineIndex <= span.end_index) return true;
  }
  if (!includeOocSoft) {
    for (const span of masks.oocSoft) {
      if (lineIndex >= span.start_index && lineIndex <= span.end_index) return true;
    }
  }
  for (const span of masks.combat) {
    if (lineIndex >= span.start_index && lineIndex <= span.end_index) return true;
  }
  return false;
}

function formatLine(entry: ReturnType<typeof buildTranscript>[number]): string {
  return `[L${entry.line_index}] ${entry.author_name}: ${entry.content}`;
}

function getSpanLines(
  transcript: ReturnType<typeof buildTranscript>,
  span: { start_index: number; end_index: number }
): ReturnType<typeof buildTranscript> {
  return transcript.slice(span.start_index, span.end_index + 1);
}

function printSpanPreview(
  label: string,
  spans: Array<{ start_index: number; end_index: number; chunk_id?: string }>,
  transcript: ReturnType<typeof buildTranscript>,
  lineCount: number,
  extra?: (span: { start_index: number; end_index: number; chunk_id?: string }) => string | null
): void {
  console.log(`\n${label}: ${spans.length}`);
  for (const span of spans) {
    const header = `${span.chunk_id ?? "chunk"} [${span.start_index}-${span.end_index}]`;
    const extraLabel = extra ? extra(span) : null;
    console.log(extraLabel ? `  ${header} ${extraLabel}` : `  ${header}`);

    if (lineCount > 0) {
      const lines = getSpanLines(transcript, span);
      const head = lines.slice(0, lineCount).map(formatLine);
      const tail = lines.slice(Math.max(0, lines.length - lineCount)).map(formatLine);
      for (const line of head) console.log(`    ${line}`);
      if (tail.length > 0 && lines.length > lineCount) {
        console.log("    ...");
        for (const line of tail) console.log(`    ${line}`);
      }
    }
  }
}

function insertCausalLoops(sessionId: string, loops: any[]): void {
  const db = getDb();
  const del = db.prepare("DELETE FROM causal_loops WHERE session_id = ?");
  const ins = db.prepare(
    `INSERT INTO causal_loops (
       id, session_id, chunk_id, chunk_index, actor, start_index, end_index,
       intent_text, intent_type, consequence_type, roll_type, roll_subtype,
       outcome_text, confidence, intent_anchor_index, consequence_anchor_index, created_at_ms
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  db.transaction(() => {
    del.run(sessionId);
    for (const loop of loops) {
      ins.run(
        loop.id,
        sessionId,
        loop.chunk_id,
        loop.chunk_index,
        loop.actor,
        loop.start_index,
        loop.end_index,
        loop.intent_text,
        loop.intent_type,
        loop.consequence_type,
        loop.roll_type,
        loop.roll_subtype,
        loop.outcome_text,
        loop.confidence,
        loop.intent_anchor_index,
        loop.consequence_anchor_index,
        loop.created_at_ms
      );
    }
  })();
}

function printSummary(
  sessionLabel: string | null,
  loops: any[],
  transcript: ReturnType<typeof buildTranscript>,
  actorNameMap: Map<string, string>,
  pcLineCounts: Map<string, number>,
  dmConsequenceByChunk: Map<string, { total: number; attached: number }>,
  dmNames: Set<string>
): void {
  const total = loops.length;
  const byActor = new Map<string, number>();
  const byConsequence = new Map<string, number>();
  const byRoll = new Map<string, number>();

  for (const loop of loops) {
    byActor.set(loop.actor, (byActor.get(loop.actor) ?? 0) + 1);
    byConsequence.set(
      loop.consequence_type,
      (byConsequence.get(loop.consequence_type) ?? 0) + 1
    );
    const rollKey = loop.roll_type ?? "none";
    byRoll.set(rollKey, (byRoll.get(rollKey) ?? 0) + 1);
  }

  console.log(`\nSession: ${sessionLabel ?? "(unknown)"}`);
  console.log(`Total loops: ${total}`);

  // Calculate aggregate metrics
  const noneCount = byConsequence.get("none") ?? 0;
  const resolvedRate = total > 0 ? (1 - noneCount / total) * 100 : 0;
  
  let totalOrphans = 0;
  let totalDmConsequences = 0;
  for (const stats of dmConsequenceByChunk.values()) {
    totalOrphans += stats.total - stats.attached;
    totalDmConsequences += stats.total;
  }
  const orphanRate = totalDmConsequences > 0 ? (totalOrphans / totalDmConsequences) * 100 : 0;
  
  let totalPcLines = 0;
  for (const count of pcLineCounts.values()) {
    totalPcLines += count;
  }
  const loopsPer100Lines = totalPcLines > 0 ? (total / totalPcLines) * 100 : 0;
  
  console.log(`\nKey Metrics:`);
  console.log(`  Resolved rate: ${resolvedRate.toFixed(1)}% (${total - noneCount}/${total} loops with consequences)`);
  console.log(`  Orphan rate: ${orphanRate.toFixed(1)}% (${totalOrphans}/${totalDmConsequences} DM consequences unattached)`);
  console.log(`  Loops per 100 PC lines: ${loopsPer100Lines.toFixed(1)} (${total} loops / ${totalPcLines} PC lines)`);

  console.log("\nLoops per actor:");
  for (const [actor, count] of Array.from(byActor.entries()).sort((a, b) => b[1] - a[1])) {
    const label = actorNameMap.get(actor) ?? actor;
    console.log(`  ${label} (${actor}): ${count}`);
  }

  console.log("\nPC line counts (post-mask):");
  for (const [actor, count] of Array.from(pcLineCounts.entries()).sort((a, b) => b[1] - a[1])) {
    const label = actorNameMap.get(actor) ?? actor;
    console.log(`  ${label} (${actor}): ${count}`);
  }

  console.log("\nDM consequences per chunk:");
  for (const [chunkId, stats] of Array.from(dmConsequenceByChunk.entries())) {
    const orphan = stats.total - stats.attached;
    console.log(`  ${chunkId}: total=${stats.total} attached=${stats.attached} orphan=${orphan}`);
  }

  console.log("\nConsequence types:");
  for (const [type, count] of Array.from(byConsequence.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }

  console.log("\nRoll types:");
  for (const [type, count] of Array.from(byRoll.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }

  const sampleCount = Math.min(5, loops.length);
  if (sampleCount === 0) return;

  console.log("\nSample loops:");
  for (let i = 0; i < sampleCount; i++) {
    const loop = loops[Math.floor(Math.random() * loops.length)];
    const intent = transcript[loop.intent_anchor_index];
    const consequence = loop.consequence_anchor_index !== null
      ? transcript[loop.consequence_anchor_index]
      : null;

    const label = actorNameMap.get(loop.actor) ?? loop.actor;
    console.log(
      `  [${label}] intent@${loop.intent_anchor_index}: ${intent?.content ?? "(missing)"}`
    );
    if (consequence) {
      console.log(
        `    -> consequence@${loop.consequence_anchor_index}: ${consequence.content}`
      );
    } else {
      console.log("    -> consequence: none");
    }
  }

  const bottomLoops = loops
    .slice()
    .sort((a, b) => (a.confidence ?? 0) - (b.confidence ?? 0))
    .slice(0, Math.min(10, loops.length));

  if (bottomLoops.length > 0) {
    console.log("\nBottom confidence loops:");
    for (const loop of bottomLoops) {
      const label = actorNameMap.get(loop.actor) ?? loop.actor;
      const intent = transcript[loop.intent_anchor_index];
      const consequence = loop.consequence_anchor_index !== null
        ? transcript[loop.consequence_anchor_index]
        : null;

      console.log(
        `  [${label}] conf=${(loop.confidence ?? 0).toFixed(2)} intent@${loop.intent_anchor_index}: ${intent?.content ?? "(missing)"}`
      );
      if (consequence) {
        console.log(
          `    -> consequence@${loop.consequence_anchor_index}: ${consequence.content}`
        );
      } else {
        console.log("    -> consequence: none");
      }
    }
  }

  const unresolved = loops.filter((loop) => loop.consequence_anchor_index === null);
  const unresolvedSample = unresolved.slice(0, Math.min(10, unresolved.length));

  if (unresolvedSample.length > 0) {
    console.log("\nUnresolved loops with nearest DM consequence:");
    for (const loop of unresolvedSample) {
      const label = actorNameMap.get(loop.actor) ?? loop.actor;
      const intent = transcript[loop.intent_anchor_index];
      let nearest: { index: number; text: string } | null = null;

      for (let i = loop.intent_anchor_index + 1; i <= loop.intent_anchor_index + 30; i++) {
        const entry = transcript[i];
        if (!entry) continue;
        if (!dmNames.has(entry.author_name.toLowerCase().trim())) continue;
        const consequence = detectConsequence(entry.content);
        if (consequence.isConsequence) {
          nearest = { index: entry.line_index, text: entry.content };
          break;
        }
      }

      console.log(
        `  [${label}] intent@${loop.intent_anchor_index}: ${intent?.content ?? "(missing)"}`
      );
      if (nearest) {
        console.log(`    -> nearest DM consequence@${nearest.index}: ${nearest.text}`);
      } else {
        console.log("    -> nearest DM consequence: none within 30 lines");
      }
    }
  }
}

async function runForSession(
  sessionId: string,
  sessionLabel: string | null,
  opts: RegimeMaskOptions & {
    includeOocSoft: boolean;
    printMasks: boolean;
    printMaskLines: number;
    noMasks: boolean;
    noOocMasks: boolean;
    noCombatMasks: boolean;
  }
): Promise<void> {
  const transcript = buildTranscript(sessionId, true);
  const chunks = loadScaffoldChunks(sessionId);

  if (chunks.length === 0) {
    console.log(`Skipping ${sessionLabel ?? sessionId}: no scaffold chunks found.`);
    return;
  }

  const actors = loadPcActors();
  const actorNameMap = new Map(actors.map((a) => [a.id, a.canonical_name]));
  const computedMasks = generateRegimeMasks(chunks, transcript, opts);
  
  const masks = opts.noMasks
    ? { oocHard: [], oocSoft: [], combat: [] }
    : {
        oocHard: opts.noOocMasks ? [] : computedMasks.oocHard,
        oocSoft: opts.noOocMasks ? [] : computedMasks.oocSoft,
        combat: opts.noCombatMasks ? [] : computedMasks.combat,
      };

  const maskingPolicy = opts.noMasks
    ? "ALL OFF"
    : `OOC=${opts.noOocMasks ? "OFF" : "ON"}, Combat=${opts.noCombatMasks ? "OFF" : "ON"}`;

  console.log(`\n${"=".repeat(72)}`);
  console.log(`  Session: ${sessionLabel ?? "(unknown)"}`);
  console.log(`  Masking Policy: ${maskingPolicy}`);
  console.log(`${"=".repeat(72)}`);
  const pcLineCounts = new Map<string, number>();
  const dmConsequenceByChunk = new Map<string, { total: number; attached: number }>();
  const usedConsequenceIndices = new Set<number>();

  const uniqueSpeakers = Array.from(new Set(transcript.map((l) => l.author_name)));
  const detectedDm = detectDmSpeaker(uniqueSpeakers);
  const dmNames = buildDmNameSet(detectedDm);

  if (opts.printMasks) {
    printSpanPreview(
      "OOC hard spans",
      computedMasks.oocHard,
      transcript,
      opts.printMaskLines,
      (span) => null
    );

    printSpanPreview(
      "OOC soft spans",
      computedMasks.oocSoft,
      transcript,
      opts.printMaskLines,
      (span) => {
        const lines = getSpanLines(transcript, span);
        const alt = calculatePlayerAlternationRate(lines).toFixed(3);
        return `alt=${alt}`;
      }
    );

    printSpanPreview(
      "Combat spans",
      computedMasks.combat,
      transcript,
      opts.printMaskLines,
      (span) => {
        const stats = calculateCombatStats(getSpanLines(transcript, span));
        return `combat_density=${stats.density.toFixed(4)} combat_tokens=${stats.combatTokens}`;
      }
    );
  }

  for (const chunk of chunks) {
    for (let i = chunk.start_index; i <= chunk.end_index; i++) {
      const entry = transcript[i];
      if (!entry) continue;
      if (isLineMasked(entry.line_index, masks, opts.includeOocSoft)) continue;

      const actor = matchPcSpeaker(entry.author_name, actors);
      if (actor) {
        pcLineCounts.set(actor.id, (pcLineCounts.get(actor.id) ?? 0) + 1);
      }

      if (isDmSpeaker(entry.author_name, dmNames)) {
        const consequence = detectConsequence(entry.content);
        if (consequence.isConsequence) {
          const stats = dmConsequenceByChunk.get(chunk.chunk_id) ?? { total: 0, attached: 0 };
          stats.total += 1;
          dmConsequenceByChunk.set(chunk.chunk_id, stats);
        }
      }
    }
  }

  const loops = extractCausalLoopsFromChunks(
    sessionId,
    chunks,
    transcript,
    masks,
    actors,
    { excludeOocSoft: !opts.includeOocSoft }
  );

  for (const loop of loops) {
    if (loop.consequence_anchor_index !== null) {
      usedConsequenceIndices.add(loop.consequence_anchor_index);
    }
  }

  for (const index of usedConsequenceIndices) {
    for (const chunk of chunks) {
      if (index >= chunk.start_index && index <= chunk.end_index) {
        const stats = dmConsequenceByChunk.get(chunk.chunk_id);
        if (stats) {
          stats.attached += 1;
        }
        break;
      }
    }
  }

  insertCausalLoops(sessionId, loops);
  printSummary(
    sessionLabel,
    loops,
    transcript,
    actorNameMap,
    pcLineCounts,
    dmConsequenceByChunk,
    dmNames
  );
}

async function main() {
  const args = parseArgs();

  if (!args.all && !args.sessionLabel) {
    console.error("Missing required argument: --session <SESSION_LABEL> or --all");
    process.exit(1);
  }

  const maskOpts: RegimeMaskOptions & {
    includeOocSoft: boolean;
    printMasks: boolean;
    printMaskLines: number;
    noMasks: boolean;
    noOocMasks: boolean;
    noCombatMasks: boolean;
  } = {
    includeOocSoft: args.includeOocSoft,
    printMasks: args.printMasks,
    printMaskLines: args.printMaskLines,
    noMasks: args.noMasks,
    noOocMasks: args.noOocMasks,
    noCombatMasks: args.noCombatMasks,
    alternationThreshold: args.alternationThreshold,
    combatDensityThreshold: args.combatDensityThreshold,
    combatDensityLow: args.combatDensityLow,
    debugCombat: args.debugCombat,
  };

  if (args.all) {
    const sessions = loadAllSessions();
    for (const s of sessions) {
      await runForSession(s.session_id, s.label, maskOpts);
    }
    return;
  }

  const session = getSession(args.sessionLabel!);
  await runForSession(session.session_id, session.label, maskOpts);
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
