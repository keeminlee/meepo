/**
 * export-annotated-transcript.ts — annotated transcript with causal intent/consequence pairs.
 *
 * Runs the same chunkless kernel pipeline as export-causal-links.ts, then renders
 * each transcript line annotated with its intent/consequence pairings. OOC/combat
 * excluded regions are collapsed into <details> blocks.
 *
 * CLI:
 *   npx tsx src/tools/export-annotated-transcript.ts --session C2E20 --output annotated.md
 *
 * Flags:
 *   --session LABEL        Session to export (required)
 *   --output FILE          Output .md file (optional; prints to stdout if omitted)
 *   --minScore N           Min score to show edge annotation (default 0.1)
 *   --showCandidates       Show all scored candidates for each intent (from trace)
 *   --topNCandidates N     Max below-threshold candidates to show (default 5)
 *   --hideOoc              Omit excluded regions entirely (shorter output)
 *   --kLocal N             Max DM speaker distance (default 8)
 *   --hillTau N            Hill curve half-max distance (default 6)
 *   --hillSteepness N      Hill curve steepness exponent (default 2.2)
 *   --strongMinScore N     Min score for strong intents to claim (default 0.35)
 *   --weakMinScore N       Min score for weak intents to claim (default 0.1)
 *   --betaLex N            Lexical overlap weight (default 0.5)
 *   --skipOocRefinement    Use fast chunk-level OOC exclusion (skips LLM classification)
 *   --forceOocReclassify   Delete cached OOC classifications and re-run LLM
 */

import "dotenv/config";
import { writeFileSync } from "node:fs";
import { getDb } from "../db.js";
import { buildTranscript } from "../ledger/transcripts.js";
import { generateRegimeMasks, type RegimeChunk } from "../causal/pruneRegimes.js";
import { buildEligibilityMask, buildRefinedEligibilityMask } from "../causal/eligibilityMask.js";
import { extractCausalLinksKernel, type KernelInput } from "../causal/extractCausalLinksKernel.js";
import { buildDmNameSet, detectDmSpeaker } from "../ledger/scaffoldSpeaker.js";
import { loadRegistry } from "../registry/loadRegistry.js";
import type { CausalLink, EligibilityMask, IntentDebugTrace } from "../causal/types.js";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

interface CliArgs {
  sessionLabel: string | null;
  output: string | null;
  minScore: number;
  showCandidates: boolean;
  topNCandidates: number;
  hideOoc: boolean;
  kLocal: number;
  hillTau: number;
  hillSteepness: number;
  strongMinScore: number;
  weakMinScore: number;
  betaLex: number;
  skipOocRefinement: boolean;
  forceOocReclassify: boolean;
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  const raw: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) { raw[key] = next; i++; }
    else raw[key] = true;
  }
  return {
    sessionLabel:       (raw.session as string) || null,
    output:             (raw.output  as string) || null,
    minScore:           raw.minScore          ? Number(raw.minScore)          : 0.1,
    showCandidates:     Boolean(raw.showCandidates),
    topNCandidates:     raw.topNCandidates    ? Number(raw.topNCandidates)    : 5,
    hideOoc:            Boolean(raw.hideOoc),
    kLocal:             raw.kLocal            ? Number(raw.kLocal)            : 8,
    hillTau:            raw.hillTau           ? Number(raw.hillTau)           : 6,
    hillSteepness:      raw.hillSteepness     ? Number(raw.hillSteepness)     : 2.2,
    strongMinScore:     raw.strongMinScore    ? Number(raw.strongMinScore)    : 0.35,
    weakMinScore:       raw.weakMinScore      ? Number(raw.weakMinScore)      : 0.1,
    betaLex:            raw.betaLex           ? Number(raw.betaLex)           : 0.5,
    skipOocRefinement:  Boolean(raw.skipOocRefinement),
    forceOocReclassify: Boolean(raw.forceOocReclassify),
  };
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

function getSession(label: string) {
  const db = getDb();
  const row = db
    .prepare("SELECT session_id, label FROM sessions WHERE label = ? ORDER BY created_at_ms DESC LIMIT 1")
    .get(label) as { session_id: string; label: string } | undefined;
  if (!row) throw new Error(`Session not found: ${label}`);
  return row;
}

function loadScaffoldChunks(sessionId: string): RegimeChunk[] {
  const db = getDb();
  const scaffold = db
    .prepare(
      `SELECT event_id, start_index, end_index FROM event_scaffold
       WHERE session_id = ? ORDER BY start_index ASC`,
    )
    .all(sessionId) as Array<{ event_id: string; start_index: number; end_index: number }>;

  const events = db
    .prepare(`SELECT start_index, end_index, is_ooc FROM events WHERE session_id = ?`)
    .all(sessionId) as Array<{ start_index: number; end_index: number; is_ooc: number }>;

  const oocMap = new Map<string, boolean>();
  for (const e of events) oocMap.set(`${e.start_index}:${e.end_index}`, e.is_ooc === 1);

  return scaffold.map((row, idx) => ({
    chunk_id: row.event_id,
    chunk_index: idx,
    start_index: row.start_index,
    end_index: row.end_index,
    is_ooc: oocMap.get(`${row.start_index}:${row.end_index}`),
  }));
}

// ---------------------------------------------------------------------------
// Markdown rendering helpers
// ---------------------------------------------------------------------------

function esc(text: string): string {
  return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function snip(text: string, max = 90): string {
  const t = text.replace(/\n/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "..." : t;
}

function fmtScore(score: number): string {
  return `**${score.toFixed(3)}**`;
}

function getLinkStrength(link: CausalLink): number {
  return link.strength ?? link.strength_ce ?? link.score ?? 0;
}

function renderIntentBlock(
  link: CausalLink,
  trace: IntentDebugTrace | undefined,
  transcript: Array<{ line_index: number; content: string; author_name: string }>,
  args: CliArgs,
): string[] {
  const lines: string[] = [];
  const strength = link.intent_strength === "strong" ? "**strong**" : "weak";
  const causeType = link.cause_type ?? link.intent_type;
  const effectType = link.effect_type ?? link.consequence_type;

  lines.push(`> 🎯 **CAUSE** \`${link.actor}\` | ${strength} | \`${causeType}\``);

  if (link.claimed && link.consequence_anchor_index !== null) {
    const consLine = transcript[link.consequence_anchor_index];
    const speaker = consLine?.author_name ?? "?";
    lines.push(
      `> ↳ **[L${String(link.consequence_anchor_index).padStart(4, "0")}]** \`${effectType}\` | ${esc(speaker)} | strength=${fmtScore(getLinkStrength(link))} | d=${link.distance}`,
    );
    lines.push(`> *${esc(snip(link.consequence_text ?? ""))}*`);
  } else {
    lines.push(`> ↳ *(unclaimed — no effect met threshold)*`);
  }

  // Optionally show below-threshold candidates
  if (args.showCandidates && trace) {
    const others = trace.candidates
      .filter((c) => c.consequence_index !== link.consequence_anchor_index)
      .sort((a, b) => b.final_score - a.final_score)
      .slice(0, args.topNCandidates);

    if (others.length > 0) {
      lines.push(`>`);
      lines.push(`> <details>`);
      lines.push(`> <summary>Other candidates (${others.length} shown)</summary>`);
      lines.push(`>`);
      lines.push(`> | Line | Speaker | d | D-score | Lex | Boost | Final | Status |`);
      lines.push(`> |------|---------|---|---------|-----|-------|-------|--------|`);
      const threshold = link.intent_strength === "strong" ? args.strongMinScore : args.weakMinScore;
      for (const c of others) {
        const sp = transcript[c.consequence_index]?.author_name ?? "?";
        const flag = c.final_score < threshold ? "below" : "lost";
        lines.push(
          `> | [L${String(c.consequence_index).padStart(4, "0")}] | ${sp} | ${c.distance} | ${c.distance_score.toFixed(3)} | ${c.lexical_score.toFixed(3)} | ${c.answer_boost.toFixed(3)} | ${c.final_score.toFixed(3)} | ${flag} |`,
        );
      }
      lines.push(`> </details>`);
    }
  }

  return lines;
}

function renderConsequenceBlock(
  link: CausalLink,
  transcript: Array<{ line_index: number; content: string; author_name: string }>,
): string[] {
  const lines: string[] = [];
  const strength = link.intent_strength === "strong" ? "**strong**" : "weak";
  const effectType = link.effect_type ?? link.consequence_type;
  lines.push(`> ↩ **EFFECT** \`${effectType}\``);
  lines.push(
    `> ← **[L${String(link.intent_anchor_index).padStart(4, "0")}]** \`${link.actor}\` | ${strength} | strength=${fmtScore(getLinkStrength(link))} | d=${link.distance}`,
  );
  const intentLine = transcript[link.intent_anchor_index];
  lines.push(`> *${esc(snip(intentLine?.content ?? link.intent_text))}*`);
  return lines;
}

function renderExcludedBlock(
  startIdx: number,
  endIdx: number,
  reason: string,
  transcript: Array<{ line_index: number; content: string; author_name: string }>,
): string[] {
  const count = endIdx - startIdx + 1;
  const label =
    reason === "combat"
      ? "Combat"
      : reason === "ooc_hard"
        ? "OOC (hard)"
        : reason === "ooc_soft"
          ? "OOC (soft)"
          : "OOC (refined)";
  const icon = reason === "combat" ? "⚔️" : "🔇";
  const lines: string[] = [];
  lines.push(
    `<details><summary>${icon} <b>${label}</b> · [L${String(startIdx).padStart(4, "0")}–L${String(endIdx).padStart(4, "0")}] · ${count} line${count !== 1 ? "s" : ""}</summary>`,
  );
  lines.push(``);
  lines.push("```");
  for (let i = startIdx; i <= endIdx; i++) {
    const entry = transcript[i];
    if (entry) {
      lines.push(`[L${String(i).padStart(4, "0")}] ${entry.author_name}: ${entry.content.replace(/\n/g, " ").trim()}`);
    }
  }
  lines.push("```");
  lines.push(``);
  lines.push(`</details>`);
  lines.push(``);
  return lines;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs();

  if (!args.sessionLabel) {
    console.error("Usage: npx tsx src/tools/export-annotated-transcript.ts --session <LABEL> [--output FILE]");
    console.error("  --minScore N           Min edge strength to annotate (default 0.1)");
    console.error("  --hideOoc              Omit excluded regions from output");
    console.error("  --showCandidates       Show all scored candidates on intent lines");
    console.error("  --skipOocRefinement    Skip LLM OOC classification");
    process.exit(1);
  }

  const session = getSession(args.sessionLabel);
  const sessionId = session.session_id;

  console.error(`Loading session ${args.sessionLabel}...`);
  const transcript = buildTranscript(sessionId, true);
  const chunks = loadScaffoldChunks(sessionId);

  console.error(`Generating regime masks (${chunks.length} chunks)...`);
  const regimeMasks = generateRegimeMasks(chunks, transcript, {});

  console.error(`Loading PC actors from registry...`);
  const registry = loadRegistry();
  const actors = registry.characters
    .filter((c) => c.type === "pc")
    .map((pc) => ({ id: pc.id, canonical_name: pc.canonical_name, aliases: pc.aliases ?? [] }));

  console.error(`Detecting DM speaker...`);
  const uniqueSpeakers = Array.from(new Set(transcript.map((l) => l.author_name)));
  const detectedDm = detectDmSpeaker(uniqueSpeakers);
  const dmSpeaker = buildDmNameSet(detectedDm);

  if (args.skipOocRefinement) {
    console.error(`Building eligibility mask (fast mode, chunk-level OOC)...`);
  } else {
    const oocCount = regimeMasks.oocHard.length + regimeMasks.oocSoft.length;
    const note = args.forceOocReclassify ? ", cache cleared" : ", cached where available";
    console.error(`Building eligibility mask (LLM-refined OOC, ${oocCount} span(s)${note})...`);
  }
  const mask: EligibilityMask = args.skipOocRefinement
    ? buildEligibilityMask(transcript, regimeMasks, sessionId)
    : await buildRefinedEligibilityMask(transcript, regimeMasks, sessionId, undefined, args.forceOocReclassify);

  console.error(`Extracting causal links (K_local=${args.kLocal}, tau=${args.hillTau}, p=${args.hillSteepness}, betaLex=${args.betaLex})...`);
  const kernelInput: KernelInput = {
    sessionId,
    transcript,
    eligibilityMask: mask,
    actors,
    dmSpeaker,
    kLocal: args.kLocal,
    strongMinScore: args.strongMinScore,
    weakMinScore: args.weakMinScore,
    hillTau: args.hillTau,
    hillSteepness: args.hillSteepness,
    betaLex: args.betaLex,
  };

  const { links, traces } = extractCausalLinksKernel(kernelInput, /* emitTraces= */ true);

  // ---------------------------------------------------------------------------
  // Build lookup maps
  // ---------------------------------------------------------------------------

  const linkByIntentAnchor = new Map<number, CausalLink>();
  for (const link of links) linkByIntentAnchor.set(link.intent_anchor_index, link);

  const linkByConsequenceAnchor = new Map<number, CausalLink>();
  for (const link of links) {
    if (link.claimed && link.consequence_anchor_index !== null) {
      linkByConsequenceAnchor.set(link.consequence_anchor_index, link);
    }
  }

  const traceByAnchor = new Map<number, IntentDebugTrace>();
  if (traces) for (const t of traces) traceByAnchor.set(t.anchor_index, t);

  // Build per-line exclusion reason array
  const excludedReason = new Array<string | null>(transcript.length).fill(null);
  for (const r of mask.excluded_ranges) {
    for (let i = r.start_index; i <= r.end_index; i++) {
      if (excludedReason[i] === null) excludedReason[i] = r.reason;
    }
  }

  // Compute contiguous excluded runs for block rendering
  interface ExcludedRun { start: number; end: number; reason: string }
  const excludedRuns: ExcludedRun[] = [];
  {
    let runStart: number | null = null;
    let runReason: string | null = null;
    for (let i = 0; i <= transcript.length; i++) {
      const r = i < transcript.length ? (excludedReason[i] ?? null) : null;
      if (r !== null && runStart === null) { runStart = i; runReason = r; }
      else if ((r === null || r !== runReason) && runStart !== null) {
        excludedRuns.push({ start: runStart, end: i - 1, reason: runReason! });
        runStart = r !== null ? i : null;
        runReason = r;
      }
    }
  }
  const excludedBlockByStart = new Map<number, ExcludedRun>();
  for (const run of excludedRuns) excludedBlockByStart.set(run.start, run);

  // ---------------------------------------------------------------------------
  // Stats for header
  // ---------------------------------------------------------------------------

  const eligibleCount = mask.eligible_mask.filter(Boolean).length;
  const claimed = links.filter((l) => l.claimed);
  const unclaimed = links.filter((l) => !l.claimed);

  const refinedRanges = mask.excluded_ranges.filter((r) => r.reason === "ooc_refined");
  const oocSpanLines = [...regimeMasks.oocHard, ...regimeMasks.oocSoft].reduce(
    (s, r) => s + (r.end_index - r.start_index + 1), 0,
  );
  const refinedExcludedLines = refinedRanges.reduce((s, r) => s + (r.end_index - r.start_index + 1), 0);
  const recoveredLines = oocSpanLines - refinedExcludedLines;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const out: string[] = [];

  out.push(`# Annotated Transcript: ${args.sessionLabel}`);
  out.push(``);
  out.push(`| | |`);
  out.push(`|---|---|`);
  out.push(`| **Session** | \`${sessionId}\` |`);
  out.push(`| **Lines** | ${transcript.length} total, ${eligibleCount} eligible, ${transcript.length - eligibleCount} excluded |`);
  out.push(`| **OOC spans** | hard=${regimeMasks.oocHard.length}, soft=${regimeMasks.oocSoft.length}, combat=${regimeMasks.combat.length} |`);
  if (!args.skipOocRefinement) {
    out.push(`| **LLM OOC** | ${refinedRanges.length} confirmed sub-ranges, ${recoveredLines}/${oocSpanLines} flagged lines recovered as IC |`);
  }
  out.push(`| **Links** | ${links.length} total, ${claimed.length} claimed, ${unclaimed.length} unclaimed |`);
  out.push(`| **Kernel** | K=${args.kLocal}, tau=${args.hillTau}, p=${args.hillSteepness}, betaLex=${args.betaLex}, strong>=${args.strongMinScore}, weak>=${args.weakMinScore} |`);
  out.push(`| **OOC mode** | ${args.skipOocRefinement ? "chunk-level (fast)" : "LLM-refined"} |`);
  out.push(``);
  out.push(`---`);
  out.push(``);

  let i = 0;
  while (i < transcript.length) {
    const entry = transcript[i];
    const lineIdx = entry.line_index;

    // Contiguous excluded block
    const run = excludedBlockByStart.get(lineIdx);
    if (run) {
      if (!args.hideOoc) {
        out.push(...renderExcludedBlock(run.start, run.end, run.reason, transcript));
      }
      i += run.end - run.start + 1;
      continue;
    }

    const intentLink = linkByIntentAnchor.get(lineIdx);
    const consequenceLink = linkByConsequenceAnchor.get(lineIdx);
    const hasAnnotation = intentLink !== undefined || consequenceLink !== undefined;
    const content = entry.content.replace(/\n/g, " ").trim();

    if (hasAnnotation) {
      out.push(`**[L${String(lineIdx).padStart(4, "0")}]** **${esc(entry.author_name)}**  `);
      out.push(`${esc(content)}`);
      out.push(``);

      if (intentLink) {
        if (!intentLink.claimed || getLinkStrength(intentLink) >= args.minScore) {
          out.push(...renderIntentBlock(intentLink, traceByAnchor.get(lineIdx), transcript, args));
          out.push(``);
        }
      }

      if (consequenceLink) {
        out.push(...renderConsequenceBlock(consequenceLink, transcript));
        out.push(``);
      }

      out.push(`---`);
      out.push(``);
    } else {
      out.push(`[L${String(lineIdx).padStart(4, "0")}] ${esc(entry.author_name)}: ${esc(content)}`);
      out.push(``);
    }

    i++;
  }

  out.push(`---`);
  out.push(``);
  out.push(`*Generated ${new Date().toISOString()} | ${args.sessionLabel} | ${claimed.length}/${links.length} links claimed*`);

  const output = out.join("\n");

  if (args.output) {
    writeFileSync(args.output, output, "utf8");
    console.error(`Wrote ${args.output}`);
  } else {
    console.log(output);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
