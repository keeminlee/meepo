import "dotenv/config";
import { getDb } from "../db.js";
import { buildTranscript } from "../ledger/transcripts.js";
import { generateRegimeMasks, type RegimeChunk } from "../causal/pruneRegimes.js";
import { buildEligibilityMask, buildRefinedEligibilityMask } from "../causal/eligibilityMask.js";
import { buildDmNameSet, detectDmSpeaker } from "../ledger/scaffoldSpeaker.js";
import { loadRegistry } from "../registry/loadRegistry.js";
import { runRounds, type HierarchyParams } from "../causal/runHierarchyRounds.js";
import { writeHierarchyArtifacts } from "../causal/writeHierarchyArtifacts.js";

interface CliArgs {
  sessionLabel: string | null;
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
    maxLevel: args.maxLevel ? Number(args.maxLevel) : 3,
    outDir: (args.outDir as string) || "runs/causal",
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
    console.error("Refinement:");
    console.error("  --skipOocRefinement");
    console.error("  --forceOocReclassify");
    process.exit(1);
  }

  const session = getSession(args.sessionLabel);
  const sessionId = session.session_id;

  console.log("Causal Hierarchy Pipeline (3-round L0→L1→L2→L3)");
  console.log("Round 1 LINK: extractCausalLinksKernel (L0→L1)");
  console.log("Round 1 ANNEAL: mass coupling (link↔link edges)");
  if (args.maxLevel >= 2) {
    console.log("Round 2 LINK: linkLinksKernel (L1→L2 composites)");
    console.log("Round 2 ANNEAL: mass coupling + strength propagation");
  }
  if (args.maxLevel >= 3) {
    console.log("Round 3 LINK: linkLinksKernel (L2→L3 composites)");
    console.log("Round 3 ANNEAL: mass coupling + strength propagation");
  }

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

  const params: HierarchyParams = {
    kernel: {
      kLocal: 8,
      hillTau: 8,
      hillSteepness: 2.2,
      betaLex: 2.0,
      strongMinScore: 1.0,
      weakMinScore: 1.0,
      ambientMassBoost: args.ambientMassBoost,
    },
    anneal: {
      windowLinks: 8,
      hillTau: 8,
      hillSteepness: 2.2,
      betaLex: 0.8,
      lambda: 0.8,
      topKContrib: 5,
      ambientMassBoost: args.ambientMassBoost,
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
    console.log(`\nRound ${round.round} ${round.phase.toUpperCase()}: ${round.metrics.label}`);
    for (const [key, value] of Object.entries(round.metrics.counts)) {
      console.log(`  ${key}: ${value}`);
    }
    for (const [key, stat] of Object.entries(round.metrics.stats)) {
      console.log(
        `  ${key}: p50=${stat.p50.toFixed(2)} p90=${stat.p90.toFixed(2)} max=${stat.max.toFixed(2)}`,
      );
    }
  }

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
    console.log(`Artifacts written to ${runDir}`);
  }
}

main().catch((err) => {
  console.error("\nERROR:", err instanceof Error ? err.message : err);
  if (err instanceof Error) console.error(err.stack);
  process.exit(1);
});
