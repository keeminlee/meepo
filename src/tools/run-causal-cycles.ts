import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../db.js";
import { buildTranscript } from "../ledger/transcripts.js";
import { generateRegimeMasks, type RegimeChunk } from "../causal/pruneRegimes.js";
import { buildEligibilityMask, buildRefinedEligibilityMask, logEligibilitySummary } from "../causal/eligibilityMask.js";
import { buildDmNameSet, detectDmSpeaker } from "../ledger/scaffoldSpeaker.js";
import { loadRegistry } from "../registry/loadRegistry.js";
import { runRounds, type HierarchyParams, type ConvergenceParams } from "../causal/runHierarchyRounds.js";
import { DEFAULT_LEVERS, type LeverParams } from "../causal/evidenceStrength.js";
import { writeHierarchyArtifacts } from "../causal/writeHierarchyArtifacts.js";
import { getEnvBool } from "../config/rawEnv.js";
import { resolveCampaignRunsDir } from "../dataPaths.js";
import { getDefaultCampaignSlug } from "../campaign/defaultCampaign.js";

interface CliArgs {
  sessionLabel: string | null;
  campaign: string;
  maxLevel: number;
  outDir: string;
  noArtifacts: boolean;
  outlineTopK: number;
  llTau: number;
  llSteepness: number;
  llBetaLex: number;
  llMinBridge: number;
  llMaxForwardLines: number;
  llKLocalLinks: number;
  ambientMassBoost: boolean;
  skipOocRefinement: boolean;
  forceOocReclassify: boolean;
  kernelKLocal: number;
  kernelStrongMinScore: number;
  kernelWeakMinScore: number;
  kernelMinPairStrength?: number;
  kernelMaxL1Span: number;
  /** Run anneal until mass stable when a link round produces 0 new composites. */
  converge: boolean;
  annealEpsilon: number;
  maxAnnealIterations: number;
  maxRounds: number;
  /** Use two-lever evidence→strength pipeline. */
  levers: boolean;
  locality: number;
  coupling: number;
  growthResistance: number;
  keywordLexBonus: number;
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

  const campaign = ((args.campaign as string) || getDefaultCampaignSlug()).toString();
  const outDirDefault = path.join(
    resolveCampaignRunsDir(campaign, { forWrite: true, ensureExists: true }),
    "causal"
  );

  return {
    sessionLabel: (args.session as string) || null,
    campaign,
    maxLevel: args.maxLevel ? Number(args.maxLevel) : 3,
    outDir: (args.outDir as string) || outDirDefault,
    noArtifacts: Boolean(args.noArtifacts),
    outlineTopK: args.outlineTopK ? Number(args.outlineTopK) : 50,
    llTau: args.llTau ? Number(args.llTau) : 30,
    llSteepness: args.llSteepness ? Number(args.llSteepness) : 2.2,
    llBetaLex: args.llBetaLex ? Number(args.llBetaLex) : 2.0,
    llMinBridge: args.llMinBridge ? Number(args.llMinBridge) : 1.0,
    llMaxForwardLines: args.llMaxForwardLines ? Number(args.llMaxForwardLines) : 120,
    llKLocalLinks: args.llKLocalLinks ? Number(args.llKLocalLinks) : 8,
    ambientMassBoost: Boolean(args.ambientMassBoost),
    skipOocRefinement: Boolean(args.skipOocRefinement),
    forceOocReclassify: Boolean(args.forceOocReclassify),
    kernelKLocal: args.kernelKLocal ? Number(args.kernelKLocal) : 8,
    kernelStrongMinScore: args.kernelStrongMinScore ? Number(args.kernelStrongMinScore) : 1.0,
    kernelWeakMinScore: args.kernelWeakMinScore ? Number(args.kernelWeakMinScore) : 1.0,
    kernelMinPairStrength: args.kernelMinPairStrength ? Number(args.kernelMinPairStrength) : undefined,
    kernelMaxL1Span: args.kernelMaxL1Span ? Number(args.kernelMaxL1Span) : 18,
    converge: Boolean(args.converge),
    annealEpsilon: args.annealEpsilon ? Number(args.annealEpsilon) : 0.001,
    maxAnnealIterations: args.maxAnnealIterations ? Number(args.maxAnnealIterations) : 20,
    maxRounds: args.maxRounds ? Number(args.maxRounds) : 10,
    levers: Boolean(args.levers),
    locality: args.locality != null ? Number(args.locality) : 0,
    coupling: args.coupling != null ? Number(args.coupling) : DEFAULT_LEVERS.coupling,
    growthResistance: args.growthResistance != null ? Number(args.growthResistance) : DEFAULT_LEVERS.growth_resistance,
    keywordLexBonus: args.keywordLexBonus != null ? Number(args.keywordLexBonus) : DEFAULT_LEVERS.keywordLexBonus ?? 0.25,
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

function validateTimelineAnneals(runDir: string): void {
  const timelinePath = path.join(runDir, "output.timeline.md");
  const annealsPath = path.join(runDir, "output.absorptions.json");
  if (!fs.existsSync(timelinePath) || !fs.existsSync(annealsPath)) return;

  const timeline = fs.readFileSync(timelinePath, "utf8");
  const payload = JSON.parse(fs.readFileSync(annealsPath, "utf8")) as {
    count: number;
    line_annotations: Array<{ line_index: number; target_center: number; anneal_rounds: number[] }>;
  };

  // Parse timeline annotations first, then compare maps (more robust than per-line regex matching).
  const observedByLine = new Map<number, { target_center: number; rounds: Set<number> }>();
  const annotationRegex = /- L(\d+)[^\n]*absorbed into L([0-9]+(?:\.[0-9]+)?)\s+\(absorption (r\d+(?:,r\d+)*)\)/g;
  for (const match of timeline.matchAll(annotationRegex)) {
    const lineIndex = Number(match[1]);
    const center = Number(match[2]);
    const rounds = (match[3] ?? "")
      .split(",")
      .map((r) => Number(r.replace(/^r/, "")))
      .filter((n) => Number.isFinite(n) && n > 0);
    const cur = observedByLine.get(lineIndex) ?? { target_center: center, rounds: new Set<number>() };
    if (!observedByLine.has(lineIndex)) cur.target_center = center;
    for (const r of rounds) cur.rounds.add(r);
    observedByLine.set(lineIndex, cur);
  }

  let missing = 0;
  const missingExamples: string[] = [];
  for (const ann of payload.line_annotations) {
    const observed = observedByLine.get(ann.line_index);
    const expectedRounds = [...ann.anneal_rounds].sort((a, b) => a - b);
    const observedRounds = observed ? Array.from(observed.rounds).sort((a, b) => a - b) : [];
    const centerMatches = observed ? observed.target_center === ann.target_center : false;
    const roundsMatch =
      observedRounds.length === expectedRounds.length &&
      observedRounds.every((v, i) => v === expectedRounds[i]);
    if (!observed || !centerMatches || !roundsMatch) {
      missing++;
      if (missingExamples.length < 10) {
        const expected = `L${ann.line_index} -> L${ann.target_center} (absorption ${ann.anneal_rounds.map((r) => `r${r}`).join(",")})`;
        const got = observed
          ? `got L${ann.line_index} -> L${observed.target_center} (absorption ${observedRounds.map((r) => `r${r}`).join(",")})`
          : "not present in timeline";
        missingExamples.push(`${expected}; ${got}`);
      }
    }
  }

  console.error(`[absorption-validate] expected annotations: ${payload.count}`);
  console.error(`[absorption-validate] missing in timeline: ${missing}`);
  if (missingExamples.length > 0) {
    console.error("[absorption-validate] missing examples:");
    for (const ex of missingExamples) console.error(`  - ${ex}`);
  }
}

async function main() {
  const args = parseArgs();
  if (!args.sessionLabel) {
    console.error("Usage: npx tsx src/tools/run-causal-cycles.ts --session C2E20 [options]");
    console.error("");
    console.error("Hierarchy:");
    console.error("  --maxLevel 3 (1/2/3)");
    console.error("  --outlineTopK 50");
    console.error("  --outDir runs/causal");
    console.error("  --noArtifacts");
    console.error("");
    console.error("Link-Link params (for L1→L2 and L2→L3):");
    console.error("  --llTau 30 --llSteepness 2.2 --llBetaLex 2.0");
    console.error("  --llMinBridge 1.0");
    console.error("  --llMaxForwardLines 120");
    console.error("  --llKLocalLinks 8");
    console.error("  --ambientMassBoost");
    console.error("");
    console.error("Kernel thresholds / windows:");
    console.error("  --kernelKLocal 8");
    console.error("  --kernelStrongMinScore 1.0");
    console.error("  --kernelWeakMinScore 1.0");
    console.error("  --kernelMinPairStrength <number>");
    console.error("  --kernelMaxL1Span 18");
    console.error("");
  console.error("Convergence (stop when no new composites and no new absorptions):");
  console.error("  --converge");
  console.error("  --annealEpsilon 0.001  (unused placeholder)");
  console.error("  --maxAnnealIterations 20");
  console.error("  --maxRounds 10  (max link+anneal rounds; default 10)");
  console.error("");
  console.error("Two-lever (evidence→strength) refactor:");
  console.error("  --levers");
  console.error("  --locality 0  (0→tau 8, 1→tau 4; default 0.7)");
  console.error("  --coupling 1  (E^γ; default 1)");
  console.error("  --growthResistance 0.15  (η in T=T0+η·g(m); default 0.15)");
  console.error("  --keywordLexBonus 0.25  (extra lexical gain for overlap on detection keywords)");
  console.error("");
  console.error("Refinement:");
  console.error("  --skipOocRefinement");
  console.error("  --forceOocReclassify");
  process.exit(1);
}

  const session = getSession(args.sessionLabel);
  const sessionId = session.session_id;

  console.log("Causal Hierarchy Pipeline (3-round L0→L1→L2→L3)");
  console.log("Round 1 LINK: extractCausalLinksKernel (L0→L1)");
  console.log("Round 1 ANNEAL: absorption (L0 singleton/stray -> L1+)");
  if (args.maxLevel >= 2) {
    console.log("Round 2 LINK: linkLinksKernel (L1→L2 composites)");
    console.log("Round 2 ANNEAL: absorption + strength propagation");
  }
  if (args.maxLevel >= 3) {
    console.log("Round 3 LINK: linkLinksKernel (L2→L3 composites)");
    console.log("Round 3 ANNEAL: absorption + strength propagation");
  }
  if (args.converge) {
    console.log("Convergence: when a link round produces 0 new composites and anneal produces 0 new absorptions, stop early.");
  }
  console.log("Max rounds: " + args.maxRounds);


  console.error(`Loading session ${args.sessionLabel}...`);
  const transcript = buildTranscript(sessionId, true);
  const chunks = loadScaffoldChunks(sessionId);

  console.error(`Generating regime masks (${chunks.length} chunks)...`);
  const regimeMasks = generateRegimeMasks(chunks, transcript, {});

  const registry = loadRegistry();
  const actors = registry.characters
    .filter((c) => c.type === "pc")
    .map((pc) => ({
      id: pc.id,
      canonical_name: pc.canonical_name,
      aliases: pc.aliases ?? [],
    }));

  const uniqueSpeakers = Array.from(new Set(transcript.map((l) => l.author_name)));
  const detectedDm = detectDmSpeaker(uniqueSpeakers);
  const dmSpeaker = buildDmNameSet(detectedDm);

  const mask = args.skipOocRefinement
    ? buildEligibilityMask(transcript, regimeMasks, sessionId)
    : await buildRefinedEligibilityMask(transcript, regimeMasks, sessionId, undefined, args.forceOocReclassify);

  if (getEnvBool("DEBUG_ELIGIBILITY", false)) {
    logEligibilitySummary(mask, { span: [676, 701] });
  }

  const params: HierarchyParams = {
    kernel: {
      kLocal: args.kernelKLocal,
      hillTau: 8,
      hillSteepness: 2.2,
      betaLex: 2.0,
      strongMinScore: args.kernelStrongMinScore,
      weakMinScore: args.kernelWeakMinScore,
      minPairStrength: args.kernelMinPairStrength,
      maxL1Span: args.kernelMaxL1Span,
      ambientMassBoost: args.ambientMassBoost,
    },
    anneal: {
      radiusBase: 6,
      radiusPerMass: 0.3,
      capBase: 2,
      capPerMass: 0.25,
      minCtxStrength: 0.45,
      hillTau: 8,
      hillSteepness: 2.2,
      betaLex: 0.8,
      ctxThresholdBase: 0.45,
      ctxThresholdPerLogMass: 0.0,
    },
    linkLinks: {
      kLocalLinks: args.llKLocalLinks,
      hillTau: args.llTau,
      hillSteepness: args.llSteepness,
      betaLex: args.llBetaLex,
      minBridge: args.llMinBridge,
      maxForwardLines: args.llMaxForwardLines,
    },
    maxLevel: args.maxLevel,
    maxRounds: args.maxRounds,
    ...(args.levers && {
      levers: {
        locality: args.locality,
        coupling: args.coupling,
        growth_resistance: args.growthResistance,
        thresholdBase: DEFAULT_LEVERS.thresholdBase,
        strengthScale: DEFAULT_LEVERS.strengthScale,
        keywordLexBonus: args.keywordLexBonus,
      } satisfies LeverParams,
    }),
    ...(args.converge && {
      convergence: {
        enabled: true,
        massDeltaEpsilon: args.annealEpsilon,
        maxAnnealIterations: args.maxAnnealIterations,
      } satisfies ConvergenceParams,
    }),
  };

  const result = await runRounds({
    sessionId,
    transcript,
    eligibilityMask: mask,
    actors,
    dmSpeaker,
    params,
  });

  console.log(`\nCausal Hierarchy Results (session=${sessionId}, hash=${result.provenance.param_hash})`);
  for (const round of result.allRounds) {
    const phaseTitle = round.phase === "anneal" ? "ANNEAL/ABSORPTION" : round.phase.toUpperCase();
    console.log(`\nRound ${round.round} ${phaseTitle}: ${round.metrics.label}`);
    if (round.phase === "anneal") {
      const thisRound = round.metrics.counts.absorptions_this_round ?? 0;
      const causeAdds = round.metrics.counts.absorptions_causes ?? 0;
      const effectAdds = round.metrics.counts.absorptions_effects ?? 0;
      const cumulative = round.metrics.counts.absorptions_cumulative ?? 0;
      console.log(`  absorptions: ${thisRound} (causes=${causeAdds}, effects=${effectAdds}, cumulative=${cumulative})`);
    }
    for (const [key, value] of Object.entries(round.metrics.counts)) {
      console.log(`  ${key}: ${value}`);
    }
    for (const [key, stat] of Object.entries(round.metrics.stats)) {
      console.log(
        `  ${key}: p50=${stat.p50.toFixed(2)} p90=${stat.p90.toFixed(2)} max=${stat.max.toFixed(2)}`,
      );
    }
  }

  const nodes = result.finalNodes;
  const totalLines = transcript.length;
  const eligibleLines = mask.eligible_mask.filter(Boolean).length;
  const excludedLines = Math.max(0, totalLines - eligibleLines);
  const pct = (num: number, den: number): string => (den > 0 ? `${((num / den) * 100).toFixed(1)}%` : "0.0%");

  const levelCounts = new Map<number, number>();
  for (const node of nodes) {
    const lvl = node.level ?? 1;
    levelCounts.set(lvl, (levelCounts.get(lvl) ?? 0) + 1);
  }

  const reasonPriority = ["combat", "ooc_refined", "ooc_hard", "ooc_soft", "transition", "noise"] as const;
  const reasonCounts = new Map<string, number>();
  for (const reason of reasonPriority) reasonCounts.set(reason, 0);
  for (let i = 0; i < mask.eligible_mask.length; i++) {
    if (mask.eligible_mask[i]) continue;
    const reasons = new Set(
      mask.excluded_ranges
        .filter((r) => i >= r.start_index && i <= r.end_index)
        .map((r) => r.reason),
    );
    const winner = reasonPriority.find((r) => reasons.has(r));
    if (winner) reasonCounts.set(winner, (reasonCounts.get(winner) ?? 0) + 1);
  }

  const linkedLineSet = new Set<number>();
  const absorbedLineSet = new Set<number>();
  for (const node of nodes) {
    const level = node.level ?? 1;
    const cause = node.cause_anchor_index ?? node.intent_anchor_index;
    const effect = node.effect_anchor_index ?? node.consequence_anchor_index;
    if (level === 1 && node.claimed && typeof cause === "number" && typeof effect === "number") {
      linkedLineSet.add(cause);
      linkedLineSet.add(effect);
    }
    for (const idx of node.context_line_indices ?? []) absorbedLineSet.add(idx);
  }
  const linkedOrAbsorbed = new Set<number>([...linkedLineSet, ...absorbedLineSet]);
  const linkedAndAbsorbed = new Set<number>([...linkedLineSet].filter((x) => absorbedLineSet.has(x)));
  const unlinkedUnabsorbedEligible = Array.from({ length: mask.eligible_mask.length }, (_, i) => i)
    .filter((i) => mask.eligible_mask[i] && !linkedOrAbsorbed.has(i)).length;

  const totalAbsorptions = result.allRounds
    .filter((r) => r.phase === "anneal")
    .reduce((sum, r) => sum + (r.metrics.counts.absorptions_this_round ?? 0), 0);

  console.log("\n=== FINAL OVERVIEW ===");
  console.log(`  total_lines: ${totalLines}`);
  console.log(`  actively_scanned_lines: ${eligibleLines} (${pct(eligibleLines, totalLines)})`);
  console.log(`  cut_by_eligibility: ${excludedLines} (${pct(excludedLines, totalLines)})`);
  for (const reason of reasonPriority) {
    const count = reasonCounts.get(reason) ?? 0;
    if (count > 0) console.log(`    - ${reason}: ${count} (${pct(count, totalLines)})`);
  }

  const l1 = levelCounts.get(1) ?? 0;
  const l2 = levelCounts.get(2) ?? 0;
  const l3 = levelCounts.get(3) ?? 0;
  console.log(`  final_nodes: ${nodes.length} (L1=${l1}, L2=${l2}, L3=${l3})`);
  console.log(`  total_absorptions: ${totalAbsorptions}`);

  console.log(`  linked_lines: ${linkedLineSet.size} (${pct(linkedLineSet.size, eligibleLines)} of scanned)`);
  console.log(`  absorbed_lines: ${absorbedLineSet.size} (${pct(absorbedLineSet.size, eligibleLines)} of scanned)`);
  console.log(`  linked_and_absorbed_lines: ${linkedAndAbsorbed.size} (${pct(linkedAndAbsorbed.size, eligibleLines)} of scanned)`);
  console.log(`  linked_or_absorbed_lines: ${linkedOrAbsorbed.size} (${pct(linkedOrAbsorbed.size, eligibleLines)} of scanned)`);
  console.log(`  unlinked_unabsorbed_lines: ${unlinkedUnabsorbedEligible} (${pct(unlinkedUnabsorbedEligible, eligibleLines)} of scanned)`);
  console.log("======================");

  if (!args.noArtifacts) {
    const runDir = writeHierarchyArtifacts({
      sessionId,
      sessionLabel: session.label,
      transcript,
      allRounds: result.allRounds,
      provenance: result.provenance,
      outDir: args.outDir,
      outlineTopK: args.outlineTopK,
    });
    if (getEnvBool("DEBUG_ANNEAL", false)) {
      const annealsPath = path.join(runDir, "output.absorptions.json");
      if (fs.existsSync(annealsPath)) {
        const payload = JSON.parse(fs.readFileSync(annealsPath, "utf8")) as {
          count: number;
          line_annotations: Array<{ line_index: number; target_center: number; anneal_rounds: number[] }>;
        };
        console.error(`[absorption] total line annotations: ${payload.count}`);
        for (const ann of payload.line_annotations) {
          const center = Number.isInteger(ann.target_center) ? String(ann.target_center) : ann.target_center.toString();
          console.error(
            `[absorption] L${ann.line_index} absorbed into L${center} (round ${ann.anneal_rounds.map((r) => `r${r}`).join(",")})`,
          );
        }
      }
      validateTimelineAnneals(runDir);
    }
    console.log(`Artifacts written to ${runDir}`);
  }
}

main().catch((err) => {
  console.error("\nERROR:", err instanceof Error ? err.message : err);
  if (err instanceof Error) console.error(err.stack);
  process.exit(1);
});
