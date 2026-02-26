/**
 * debug-intent-graph.ts: Debug and inspect causal link extraction.
 *
 * Runs the same chunkless extractCausalLinksKernel as export-causal-links.ts but outputs
 * a console-friendly stats summary and per-intent/per-consequence breakdowns for tuning.
 *
 * CLI:
 *   npx tsx src/tools/debug-intent-graph.ts --session C2E20 \
 *     --kLocal 8 --hillTau 2 --hillSteepness 2.2 \
 *     --printTopLinks 10 \
 *     --printCandidateBreakdownAt 234
 *
 * Flags:
 *   --session LABEL                Session to analyze (required)
 *   --kLocal N                     Max DM speaker distance (default 8)
 *   --hillTau N                    Hill curve half-max distance (default 6)
 *   --hillSteepness N              Hill curve steepness exponent (default 2.2)
 *   --betaLex N                    Lexical overlap weight in final score (default 0.5)
 *   --strongMinScore N             Min score for strong intents (default 0.35)
 *   --weakMinScore N               Min score for weak intents (default 0.1)
 *   --skipOocRefinement            Skip LLM per-event OOC classification (fast)
 *   --forceOocReclassify           Delete cached OOC spans and re-run LLM
 *   --printTopLinks N              Print top N claimed links by strength (default 10)
 *   --printCandidateBreakdownAt L  Print full trace for the intent at line L
 *
 * Returns: 0 on success, 1 on error
 */

import "dotenv/config";
import { writeFileSync } from "node:fs";
import { getDb } from "../db.js";
import { buildTranscript } from "../ledger/transcripts.js";
import { generateRegimeMasks, type RegimeChunk } from "../causal/pruneRegimes.js";
import { buildEligibilityMask, buildRefinedEligibilityMask, isLineEligible } from "../causal/eligibilityMask.js";
import { CAUSAL_KERNEL_VERSION, extractCausalLinksKernel, type KernelInput } from "../causal/extractCausalLinksKernel.js";
import { hasCausalLinks, persistCausalLinks, readCausalLinksWithMeta, type CausalLinksRunMeta } from "./causal/persistCausalLinks.js";
import { buildDmNameSet, detectDmSpeaker } from "../ledger/scaffoldSpeaker.js";
import { loadRegistry } from "../registry/loadRegistry.js";
import type { CausalLink, IntentDebugTrace } from "../causal/types.js";
import { formatCausalLinksProvenance } from "./toolProvenance.js";

interface CliArgs {
  sessionLabel: string | null;
  kLocal: number;
  hillTau: number;
  hillSteepness: number;
  betaLex: number;
  strongMinScore: number;
  weakMinScore: number;
  skipOocRefinement: boolean;
  forceOocReclassify: boolean;
  printTopLinks: number;
  printCandidateBreakdownAt: number | null;
  output: string | null;
  minScore: number;
  showCandidates: boolean;
  topNCandidates: number;
  hideOoc: boolean;
  recompute: boolean;
  useDbOnly: boolean;
  persist: boolean;
  showParams: boolean;
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  const args: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }

  return {
    sessionLabel: (args.session as string) || null,
    kLocal: args.kLocal ? Number(args.kLocal) : 8,
    hillTau: args.hillTau ? Number(args.hillTau) : 8,
    hillSteepness: args.hillSteepness ? Number(args.hillSteepness) : 2.2,
    betaLex: args.betaLex ? Number(args.betaLex) : 2.0,
    strongMinScore: args.strongMinScore ? Number(args.strongMinScore) : 1.0,
    weakMinScore: args.weakMinScore ? Number(args.weakMinScore) : 1.0,
    skipOocRefinement: Boolean(args.skipOocRefinement),
    forceOocReclassify: Boolean(args.forceOocReclassify),
    printTopLinks: args.printTopLinks ? Number(args.printTopLinks) : 10,
    printCandidateBreakdownAt: args.printCandidateBreakdownAt
      ? Number(args.printCandidateBreakdownAt)
      : null,
    output: (args.output as string) || null,
    minScore: args.minScore ? Number(args.minScore) : 0.3,
    showCandidates: Boolean(args.showCandidates),
    topNCandidates: args.topNCandidates ? Number(args.topNCandidates) : 5,
    hideOoc: Boolean(args.hideOoc),
    recompute: Boolean(args.recompute),
    useDbOnly: Boolean(args.useDbOnly),
    persist: !Boolean(args.noPersist),
    showParams: Boolean(args.showParams),
  };
}

function getSession(sessionLabel: string) {
  const db = getDb();
  const row = db
    .prepare("SELECT session_id, label FROM sessions WHERE label = ? ORDER BY created_at_ms DESC LIMIT 1")
    .get(sessionLabel) as any;
  if (!row) throw new Error(`Session not found: ${sessionLabel}`);
  return row as { session_id: string; label: string };
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

// ---------------------------------------------------------------------------
// Markdown rendering helpers (shared with export-annotated-transcript.ts)
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

function getLinkMass(link: CausalLink): number {
  return link.link_mass ?? link.mass ?? link.cause_mass ?? 0;
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

  lines.push(`> 🎯 **CAUSE** \`${link.actor}\` | ${strength} | \`${causeType}\` | mass=${getLinkMass(link).toFixed(3)}`);

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

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

function printTrace(trace: IntentDebugTrace, transcript: ReturnType<typeof buildTranscript>) {
  console.log(`\n=== Candidate Breakdown for Intent at L${trace.anchor_index} ===`);
  console.log(`Strength: ${trace.strength}  Intent Kind: ${trace.intent_kind}  Eligible: ${trace.eligible}`);
  console.log(`Candidates evaluated: ${trace.candidates.length}\n`);

  console.log(
    "  Line    Speaker              d    D-Score  Lex    Boost  Final   Status",
  );
  console.log(
    "  ------  -------------------  ---  -------  -----  -----  ------  ------",
  );
  for (const c of trace.candidates) {
    const isChosen = c.consequence_index === trace.chosen_consequence_index;
    const speaker = (transcript[c.consequence_index]?.author_name ?? "?").padEnd(19).slice(0, 19);
    const status = isChosen ? "+ CHOSEN" : "-";
    console.log(
      `  L${String(c.consequence_index).padEnd(5)}  ${speaker}  ${String(c.distance).padStart(3)}  ` +
      `${c.distance_score.toFixed(3)}    ${c.lexical_score.toFixed(3)}  ` +
      `${c.answer_boost.toFixed(3)}  ${c.final_score.toFixed(3)}  ${status}`,
    );
    // Show first 100 chars of the line
    const text = transcript[c.consequence_index]?.content ?? "";
    console.log(`        "${text.slice(0, 100)}${text.length > 100 ? "..." : ""}"`);
  }
  console.log(`\nClaim reason: ${trace.claim_reason}`);
}

async function main() {
  const args = parseArgs();
  if (!args.sessionLabel) {
    console.error("Usage: npx tsx src/tools/debug-intent-graph.ts --session C2E20 [options]");
    console.error("  --kLocal N                     (default 8)");
    console.error("  --hillTau N                    (default 6)");
    console.error("  --hillSteepness N              (default 2.2)");
    console.error("  --betaLex N                    lexical weight multiplier (default 0.5)");
    console.error("  --strongMinScore N             (default 0.35)");
    console.error("  --weakMinScore N               (default 0.1)");
    console.error("  --skipOocRefinement");
    console.error("  --forceOocReclassify");
    console.error("  --printTopLinks N              (default 10)");
    console.error("  --printCandidateBreakdownAt L");
    console.error("  --output FILE                  Write annotated .md to FILE");
    console.error("  --minScore N                   Min edge strength to annotate in .md (default 0.1)");
    console.error("  --hideOoc                      Omit excluded regions from .md output");
    console.error("  --showCandidates               Show all scored candidates in .md");
    console.error("  --recompute                    Force recompute instead of DB read");
    console.error("  --useDbOnly                    Fail if no persisted rows exist");
    console.error("  --noPersist                    Do not persist when recomputing");
    console.error("  --showParams                   Print full kernel_params_json provenance");
    process.exit(1);
  }

  const session = getSession(args.sessionLabel);
  const sessionId = session.session_id;

  console.error(`Loading session ${args.sessionLabel}...`);
  const transcript = buildTranscript(sessionId, true);
  const chunks = loadScaffoldChunks(sessionId);

  console.error(`Generating regime masks (${chunks.length} chunks)...`);
  const regimeMasks = generateRegimeMasks(chunks, transcript, {});

  if (args.skipOocRefinement) {
    console.error(`Building eligibility mask (fast mode, chunk-level OOC)...`);
  } else {
    const oocSpanCount = regimeMasks.oocHard.length + regimeMasks.oocSoft.length;
    const forceNote = args.forceOocReclassify ? ", cache cleared" : ", cached where available";
    console.error(`Building eligibility mask (LLM-refined OOC, ${oocSpanCount} span(s)${forceNote})...`);
  }
  const mask = args.skipOocRefinement
    ? buildEligibilityMask(transcript, regimeMasks, sessionId)
    : await buildRefinedEligibilityMask(transcript, regimeMasks, sessionId, undefined, args.forceOocReclassify);

  let links: CausalLink[] = [];
  let traces: IntentDebugTrace[] | undefined;
  let usedDb = false;
  let provenanceMeta: CausalLinksRunMeta | null = null;
  let provenanceSource: "db" | "recomputed" = "recomputed";

  const recomputeKernelParams = {
    kLocal: args.kLocal,
    hillTau: args.hillTau,
    hillSteepness: args.hillSteepness,
    betaLex: args.betaLex,
    strongMinScore: args.strongMinScore,
    weakMinScore: args.weakMinScore,
    skipOocRefinement: args.skipOocRefinement,
  };

  if (!args.recompute && await hasCausalLinks(sessionId)) {
    const read = await readCausalLinksWithMeta({ sessionId, includeUnclaimed: true });
    links = read.links;
    provenanceMeta = read.meta;
    usedDb = links.length > 0;
  }

  if (usedDb) {
    provenanceSource = "db";
    console.error(`Using persisted causal links (${links.length} rows).`);
    if (args.printCandidateBreakdownAt !== null || args.showCandidates) {
      console.error("Candidate traces are unavailable in DB mode; run with --recompute for traces.");
    }
  } else {
    if (args.useDbOnly) {
      throw new Error("No persisted causal links found for this session (--useDbOnly set).");
    }

    console.error("No persisted links found; recomputing causal links...");
    console.error(`Loading PC actors from registry...`);
    const registry = loadRegistry();
    const actors = registry.characters
      .filter((c) => c.type === "pc")
      .map((pc) => ({
        id: pc.id,
        canonical_name: pc.canonical_name,
        aliases: pc.aliases ?? [],
      }));

    console.error(`Detecting DM speaker...`);
    const uniqueSpeakers = Array.from(new Set(transcript.map((l) => l.author_name)));
    const detectedDm = detectDmSpeaker(uniqueSpeakers);
    const dmSpeaker = buildDmNameSet(detectedDm);

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

    const kernelOutput = extractCausalLinksKernel(kernelInput, true);
    links = kernelOutput.links;
    traces = kernelOutput.traces;
    provenanceSource = "recomputed";
    provenanceMeta = {
      session_id: sessionId,
      kernel_version: CAUSAL_KERNEL_VERSION,
      kernel_params_json: JSON.stringify(recomputeKernelParams),
      extracted_at_ms: Date.now(),
      row_count: links.length,
    };

    if (args.persist) {
      persistCausalLinks(sessionId, links, {
        kernelVersion: CAUSAL_KERNEL_VERSION,
        kernelParams: recomputeKernelParams,
        extractedAtMs: provenanceMeta.extracted_at_ms ?? Date.now(),
      });
      console.error(`Persisted ${links.length} causal_links rows`);
    }
  }

  const provenanceLines = formatCausalLinksProvenance(provenanceMeta, provenanceSource, {
    showParams: args.showParams,
  });
  for (const line of provenanceLines) {
    console.log(line);
  }

  const claimed = links.filter((l) => l.claimed);
  const unclaimed = links.filter((l) => !l.claimed);
  const eligibleCount = mask.eligible_mask.filter(Boolean).length;
  const excludedCount = transcript.length - eligibleCount;

  // ?? Summary ??????????????????????????????????????????????????????????????
  console.log(`\nSession: ${args.sessionLabel} (${sessionId})`);
  console.log(`Transcript lines: ${transcript.length}  eligible: ${eligibleCount}  excluded: ${excludedCount}`);
  console.log(`OOC spans: hard=${regimeMasks.oocHard.length}  soft=${regimeMasks.oocSoft.length}  combat=${regimeMasks.combat.length}`);
  if (!args.skipOocRefinement) {
    const refinedRanges = mask.excluded_ranges.filter((r) => r.reason === "ooc_refined");
    const refinedLinesExcluded = refinedRanges.reduce((s, r) => s + (r.end_index - r.start_index + 1), 0);
    const oocSpanLines = [...regimeMasks.oocHard, ...regimeMasks.oocSoft].reduce((s, r) => s + (r.end_index - r.start_index + 1), 0);
    const recoveredLines = oocSpanLines - refinedLinesExcluded;
    console.log(`LLM OOC refined: ${refinedRanges.length} confirmed-OOC sub-ranges  (${recoveredLines} of ${oocSpanLines} OOC-span lines recovered as IC)`);
  }
  const claimedStrong = claimed.filter((l) => l.intent_strength === "strong");
  const claimedWeak = claimed.filter((l) => l.intent_strength !== "strong");
  console.log(`\nCausal Links: ${links.length} total`);
  console.log(`  Claimed:   ${claimed.length} (${((100 * claimed.length) / links.length).toFixed(1)}%)`);
  console.log(`  Unclaimed: ${unclaimed.length}`);
  console.log(`  Strong:    ${claimedStrong.length} (${claimed.length > 0 ? ((100 * claimedStrong.length) / claimed.length).toFixed(1) : "0.0"}% of claimed)  Weak: ${claimedWeak.length}`);
  console.log(`Kernel Params: K_local=${args.kLocal}  tau=${args.hillTau}  p=${args.hillSteepness}  betaLex=${args.betaLex}  strong>=${args.strongMinScore}  weak>=${args.weakMinScore}`);

  // ?? Per-actor breakdown ???????????????????????????????????????????????????
  const byActor = new Map<string, { total: number; claimed: number }>();
  for (const link of links) {
    const entry = byActor.get(link.actor) ?? { total: 0, claimed: 0 };
    entry.total++;
    if (link.claimed) entry.claimed++;
    byActor.set(link.actor, entry);
  }
  console.log("\nLinks per actor:");
  for (const [actor, { total, claimed: c }] of Array.from(byActor.entries()).sort((a, b) => b[1].total - a[1].total)) {
    const pct = total > 0 ? ((100 * c) / total).toFixed(0) : "0";
    console.log(`  ${actor.padEnd(20)} ${String(total).padStart(4)} links  ${String(c).padStart(4)} claimed (${pct}%)`);
  }

  // ?? Strength distribution for claimed links ?????????????????????????????????
  const scores = claimed.map((l) => getLinkStrength(l));
  if (scores.length > 0) {
    console.log("\nStrength distribution (claimed):");
    console.log(`  min=${Math.min(...scores).toFixed(3)}  p25=${percentile(scores, 25).toFixed(3)}  median=${percentile(scores, 50).toFixed(3)}  p75=${percentile(scores, 75).toFixed(3)}  p95=${percentile(scores, 95).toFixed(3)}  max=${Math.max(...scores).toFixed(3)}`);
  }

  // ?? Distance distribution ????????????????????????????????????????????????
  const distances = claimed.map((l) => l.distance ?? 0);
  if (distances.length > 0) {
    const distCounts = new Map<number, number>();
    for (const d of distances) distCounts.set(d, (distCounts.get(d) ?? 0) + 1);
    const dRows = Array.from(distCounts.entries()).sort((a, b) => a[0] - b[0]);
    console.log("\nDistance distribution (claimed):");
    for (const [d, count] of dRows) {
      const bar = "#".repeat(Math.round((count / claimed.length) * 30));
      console.log(`  d=${d}  ${String(count).padStart(4)} (${((100 * count) / claimed.length).toFixed(1)}%)  ${bar}`);
    }
  }

  // ?? Top links by strength ???????????????????????????????????????????????????
  const topLinks = [...claimed].sort((a, b) => getLinkStrength(b) - getLinkStrength(a)).slice(0, args.printTopLinks);
  console.log(`\nTop ${topLinks.length} claimed links by strength:`);
  for (const link of topLinks) {
    console.log(
      `  [${getLinkStrength(link).toFixed(3)}] L${link.intent_anchor_index} -> L${link.consequence_anchor_index}  d=${link.distance}  ${link.intent_strength}/${link.intent_type}  [${link.actor}]`,
    );
    console.log(`    intent:      "${link.intent_text.slice(0, 80)}${link.intent_text.length > 80 ? "..." : ""}"`);
    console.log(`    consequence: "${(link.consequence_text ?? "").slice(0, 80)}${(link.consequence_text ?? "").length > 80 ? "..." : ""}"`);
  }

  // Write annotated .md if --output was supplied
  if (args.output) {
    await writeAnnotatedMd(args, args.sessionLabel!, sessionId, transcript, regimeMasks, mask, links, traces, provenanceLines);
  }

  // Candidate breakdown for specific line
  if (args.printCandidateBreakdownAt !== null) {
    const lineNum = args.printCandidateBreakdownAt;
    const trace = traces?.find((t) => t.anchor_index === lineNum);
    const link = links.find((l) => l.intent_anchor_index === lineNum);
    if (trace) {
      printTrace(trace, transcript);
    } else if (link) {
      // Detected as intent but no trace (weak intents don't emit traces)
      console.log(`\nL${lineNum} is a WEAK intent (no scoring trace emitted).`);
      console.log(`  Actor:    ${link.actor}`);
      console.log(`  Type:     ${link.intent_type}`);
      console.log(`  Intent:   "${link.intent_text}"`);
      if (link.claimed) {
        console.log(`  Claimed:  L${link.consequence_anchor_index}  d=${link.distance}  strength=${getLinkStrength(link).toFixed(3)}`);
        console.log(`  Response: "${link.consequence_text ?? ""}"`);
      } else {
        console.log(`  Claimed:  no`);
      }
    } else {
      // Check whether the line exists and why it might not have a trace
      const lineInTranscript = transcript[lineNum];
      if (!lineInTranscript) {
        console.log(`\nLine L${lineNum} does not exist in transcript (length=${transcript.length})`);
      } else if (!isLineEligible(mask, lineNum)) {
        const reasons = mask.excluded_ranges
          .filter((r) => lineNum >= r.start_index && lineNum <= r.end_index)
          .map((r) => r.reason);
        console.log(`\nL${lineNum} is excluded from causal analysis (reason: ${reasons.join(", ")}).`);
        console.log(`  Content: "${lineInTranscript.content}"`);
      } else {
        console.log(`\nL${lineNum} is eligible but was not detected as a PC intent.`);
        console.log(`  Speaker: ${lineInTranscript.author_name}`);
        console.log(`  Content: "${lineInTranscript.content}"`);
      }
    }
  }
}

async function writeAnnotatedMd(
  args: CliArgs,
  sessionLabel: string,
  sessionId: string,
  transcript: ReturnType<typeof buildTranscript>,
  regimeMasks: ReturnType<typeof generateRegimeMasks>,
  mask: ReturnType<typeof buildEligibilityMask>,
  links: CausalLink[],
  traces: IntentDebugTrace[] | undefined,
  provenanceLines: string[],
): Promise<void> {
  const claimed = links.filter((l) => l.claimed);
  const eligibleCount = mask.eligible_mask.filter(Boolean).length;

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

  const excludedReason = new Array<string | null>(transcript.length).fill(null);
  for (const r of mask.excluded_ranges) {
    for (let i = r.start_index; i <= r.end_index; i++) {
      if (excludedReason[i] === null) excludedReason[i] = r.reason;
    }
  }

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

  const refinedRanges = mask.excluded_ranges.filter((r) => r.reason === "ooc_refined");
  const oocSpanLines = [...regimeMasks.oocHard, ...regimeMasks.oocSoft].reduce(
    (s, r) => s + (r.end_index - r.start_index + 1), 0,
  );
  const refinedExcludedLines = refinedRanges.reduce((s, r) => s + (r.end_index - r.start_index + 1), 0);
  const recoveredLines = oocSpanLines - refinedExcludedLines;

  const out: string[] = [];
  out.push(`# Annotated Transcript: ${sessionLabel}`);
  out.push(``);
  out.push(`## Provenance`);
  out.push(``);
  for (const line of provenanceLines) out.push(line);
  out.push(``);
  out.push(`| | |`);
  out.push(`|---|---|`);
  out.push(`| **Session** | \`${sessionId}\` |`);
  out.push(`| **Lines** | ${transcript.length} total, ${eligibleCount} eligible, ${transcript.length - eligibleCount} excluded |`);
  out.push(`| **OOC spans** | hard=${regimeMasks.oocHard.length}, soft=${regimeMasks.oocSoft.length}, combat=${regimeMasks.combat.length} |`);
  if (!args.skipOocRefinement) {
    out.push(`| **LLM OOC** | ${refinedRanges.length} confirmed sub-ranges, ${recoveredLines}/${oocSpanLines} flagged lines recovered as IC |`);
  }
  const claimedStrong = claimed.filter((l) => l.intent_strength === "strong");
  const claimedWeak = claimed.filter((l) => l.intent_strength !== "strong");
  const strongPct = claimed.length > 0 ? ((100 * claimedStrong.length) / claimed.length).toFixed(1) : "0.0";
  const weakPct = claimed.length > 0 ? ((100 * claimedWeak.length) / claimed.length).toFixed(1) : "0.0";
  out.push(`| **Links** | ${links.length} total, ${claimed.length} claimed, ${links.length - claimed.length} unclaimed |`);
  out.push(`| **Strength** | strong: ${claimedStrong.length} (${strongPct}%) · weak: ${claimedWeak.length} (${weakPct}%) |`);
  out.push(`| **Kernel** | K=${args.kLocal}, tau=${args.hillTau}, p=${args.hillSteepness}, betaLex=${args.betaLex}, strong>=${args.strongMinScore}, weak>=${args.weakMinScore} |`);
  out.push(`| **OOC mode** | ${args.skipOocRefinement ? "chunk-level (fast)" : "LLM-refined"} |`);
  out.push(``);
  out.push(`---`);
  out.push(``);

  let i = 0;
  while (i < transcript.length) {
    const entry = transcript[i];
    const lineIdx = entry.line_index;

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
  out.push(`*Generated ${new Date().toISOString()} | ${sessionLabel} | ${claimed.length}/${links.length} links claimed*`);

  writeFileSync(args.output!, out.join("\n"), "utf8");
  console.error(`Wrote ${args.output}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

