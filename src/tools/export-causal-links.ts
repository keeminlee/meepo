/**
 * export-causal-links.ts: Extract and debug causal links using the chunkless kernel.
 * 
 * Runs extractCausalLinksKernel on a session, outputs CausalLink records with optional
 * allocation trace debugging.
 * 
 * CLI:
 *   npx tsx src/tools/export-causal-links.ts --session C2E20 \
 *     --output causal-debug.md \
 *     --debugLinksDense \
 *     --kLocal 8 \
 *     --hillTau 2 \
 *     --hillSteepness 2.2
 * 
 * Flags:
 *   --session LABEL          Session to extract (required)
 *   --output FILE            Output markdown file (optional; prints to stdout if omitted)
 *   --debugLinksDense        Emit IntentDebugTrace[] and render scoring breakdown
 *   --kLocal N               Max DM speaker distance (default 8)
 *   --hillTau N              Hill curve half-max distance (default 2)
 *   --hillSteepness N        Hill curve steepness exponent (default 2.2)
 *   --strongMinScore N       Min strength for high-mass causes to claim (default 0.35)
 *   --weakMinScore N         Min strength for low-mass causes to claim (default 0.1)
 *   --betaLex N              Lexical overlap weight in final strength (default 0.5) *   --skipOocRefinement      Skip LLM per-event OOC classification (fast but aggressive pruning)
 *   --forceOocReclassify     Delete cached OOC span classifications and re-run LLM * 
 *   --noPersist              Do not persist links into causal_links table
 * Output Format:
 *   = Session: C2E20
 *   = Extracted: 277 intents, 581 consequences
 *   = Created: 581 CausalLinks (claimed: 397, unclaimed: 184)
 * 
 *   ## L100: [BLY] strong intent
 *   > "Can I cast fireball?"
 *   
 *   **Claimed:** [L104] [DM responded] (d=2, strength=0.821)
 *   > "You roll for damage..."
 *   
 *   [With --debugLinksDense:]
 *   ### Scoring Breakdown (L100 → candidates)
 *   - L101: d=1, distance_score=0.667, lexical=0.2 → strength=0.777 ✓ claimed
 *   - L104: d=2, distance_score=0.400, lexical=0.5 → strength=0.821 ✓ chosen
 *   - L107: d=5, distance_score=0.020, lexical=0.1 → strength=0.030 ✗ below threshold
 * 
 * Returns: 0 on success, 1 on error
 */

import "dotenv/config";
import { writeFileSync } from "node:fs";
import { getDb } from "../db.js";
import { buildTranscript } from "../ledger/transcripts.js";
import { generateRegimeMasks, type RegimeChunk } from "../causal/pruneRegimes.js";
import { buildEligibilityMask, buildRefinedEligibilityMask } from "../causal/eligibilityMask.js";
import { CAUSAL_KERNEL_VERSION, extractCausalLinksKernel, type KernelInput } from "../causal/extractCausalLinksKernel.js";
import { hasCausalLinks, persistCausalLinks, readCausalLinksWithMeta, type CausalLinksRunMeta } from "../causal/persistCausalLinks.js";
import { buildDmNameSet, detectDmSpeaker } from "../ledger/scaffoldSpeaker.js";
import { loadRegistry } from "../registry/loadRegistry.js";
import type { CausalLink, IntentDebugTrace } from "../causal/types.js";
import { formatCausalLinksProvenance } from "./toolProvenance.js";

interface CliArgs {
  sessionLabel: string | null;
  output: string | null;
  debugLinksDense: boolean;
  kLocal: number;
  hillTau: number;
  hillSteepness: number;
  strongMinScore: number;
  weakMinScore: number;
  betaLex: number;
  skipOocRefinement: boolean;
  forceOocReclassify: boolean;
  persist: boolean;
  recompute: boolean;
  useDbOnly: boolean;
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
    output: (args.output as string) || null,
    debugLinksDense: Boolean(args.debugLinksDense),
    kLocal: args.kLocal ? Number(args.kLocal) : 8,
    hillTau: args.hillTau ? Number(args.hillTau) : 2,
    hillSteepness: args.hillSteepness ? Number(args.hillSteepness) : 2.2,
    strongMinScore: args.strongMinScore ? Number(args.strongMinScore) : 0.35,
    weakMinScore: args.weakMinScore ? Number(args.weakMinScore) : 0.1,
    betaLex: args.betaLex ? Number(args.betaLex) : 0.5,
    skipOocRefinement: Boolean(args.skipOocRefinement),
    forceOocReclassify: Boolean(args.forceOocReclassify),
    persist: !Boolean(args.noPersist),
    recompute: Boolean(args.recompute),
    useDbOnly: Boolean(args.useDbOnly),
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

function html_escape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function render_link(link: CausalLink): string {
  const causeType = link.cause_type ?? link.intent_type;
  const effectType = link.effect_type ?? link.consequence_type;
  const strength = link.strength ?? link.strength_ce ?? link.score ?? 0;
  const mass = link.link_mass ?? link.mass ?? link.cause_mass ?? 0;

  let lines = `### L${link.intent_anchor_index}: [${link.actor}] ${link.intent_strength} cause\n\n`;
  lines += `Cause Type: \`${causeType}\` | Mass: ${mass.toFixed(3)}\n\n`;
  lines += `> ${html_escape(link.cause_text ?? link.intent_text)}\n\n`;

  if (link.claimed && link.consequence_anchor_index !== null) {
    lines += `**Claimed Effect:** [L${link.consequence_anchor_index}] (\`${effectType}\`, d=${link.distance}, strength=${strength.toFixed(3)})\n\n`;
    lines += `> ${html_escape(link.effect_text ?? link.consequence_text ?? "(null)")}\n\n`;
  } else {
    lines += `**Status:** Unclaimed (no effect found or below threshold)\n\n`;
  }

  return lines;
}

function render_trace(
  trace: IntentDebugTrace,
  transcript: any[],
  debugMode: boolean
): string {
  if (!debugMode) return "";

  let lines = `#### Allocation Trace (L${trace.anchor_index})\n\n`;
  lines += `**Strength:** ${trace.strength} | **Intent Type:** ${trace.intent_kind} | **Eligible:** ${trace.eligible}\n\n`;
  lines += `**Candidates Evaluated:** ${trace.candidates.length}\n\n`;

  // Show all candidates with strengths
  lines += "| Line | Speaker | Distance | D-Strength | Lex-Score | Boost | Strength | Status |\n";
  lines += "|------|---------|----------|---------|-----------|-------|-------|--------|\n";

  for (const cand of trace.candidates) {
    const isChosen = cand.consequence_index === trace.chosen_consequence_index;
    const statusIcon = isChosen ? "✓ **CHOSEN**" : "−";
    const speaker = transcript[cand.consequence_index]?.author_name || "?";
    lines += `| L${cand.consequence_index} | ${speaker} | d=${cand.distance} | ${cand.distance_score.toFixed(3)} | ${cand.lexical_score.toFixed(3)} | ${cand.answer_boost.toFixed(3)} | ${cand.final_score.toFixed(3)} | ${statusIcon} |\n`;
  }

  lines += `\n**Claim Reason:** ${trace.claim_reason}\n\n`;
  return lines;
}

async function main() {
  const args = parseArgs();

  if (!args.sessionLabel) {
    console.error("Usage:");
    console.error("  npx tsx src/tools/export-causal-links.ts \\");
    console.error("    --session C2E20 \\");
    console.error("    [--output FILE] \\");
    console.error("    [--debugLinksDense] \\");
    console.error("    [--kLocal 8] \\");
    console.error("    [--hillTau 2] \\");
    console.error("    [--hillSteepness 2.2] \\");
    console.error("    [--recompute] \\");
    console.error("    [--useDbOnly] \\");
    console.error("    [--showParams] \\");
    console.error("    [--noPersist]");
    process.exit(1);
  }

  try {
    getDb();
    const session = getSession(args.sessionLabel);
    const sessionId = session.session_id;

    console.error(`Loading session ${args.sessionLabel}...`);
    const transcript = buildTranscript(sessionId, true);

    let links: CausalLink[] = [];
    let traces: IntentDebugTrace[] | undefined;
    let usedDb = false;
    let actorCount: number | null = null;
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
      console.error(`Using persisted causal links (${links.length} rows).`);
      provenanceSource = "db";
      if (args.debugLinksDense) {
        console.error("Debug traces are not persisted; run with --recompute for candidate traces.");
      }
    } else {
      if (args.useDbOnly) {
        throw new Error("No persisted causal links found for this session (--useDbOnly set).");
      }

      console.error("No persisted links found; recomputing causal links...");
      const chunks = loadScaffoldChunks(sessionId);
      console.error(`Generating regime masks (${chunks.length} chunks)...`);
      const regimeMasks = generateRegimeMasks(chunks, transcript, {});

      console.error(`Loading PC actors from registry...`);
      const registry = loadRegistry();
      const actors = registry.characters
        .filter((c) => c.type === "pc")
        .map((pc) => ({
          id: pc.id,
          canonical_name: pc.canonical_name,
          aliases: pc.aliases ?? [],
        }));
      actorCount = actors.length;

      console.error(`Detecting DM speaker...`);
      const uniqueSpeakers = Array.from(new Set(transcript.map((l) => l.author_name)));
      const detectedDm = detectDmSpeaker(uniqueSpeakers);
      const dmSpeaker = buildDmNameSet(detectedDm);

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

      const kernelOutput = extractCausalLinksKernel(kernelInput, args.debugLinksDense);
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

    const claimedCount = links.filter((l) => l.claimed).length;
    const unclaimedCount = links.length - claimedCount;
    const provenanceLines = formatCausalLinksProvenance(provenanceMeta, provenanceSource, {
      showParams: args.showParams,
    });
    for (const line of provenanceLines) {
      console.error(line);
    }

    // Build output
    let output = `# Causal Links Export\n\n`;
    output += `## Provenance\n\n`;
    output += provenanceLines.join("\n") + "\n\n";
    output += `**Session:** ${args.sessionLabel} (${sessionId})\n`;
    output += `**Extracted:** ${transcript.length} transcript lines, ${actorCount ?? "n/a"} PCs\n`;
    output += `**Created:** ${links.length} CausalLinks\n`;
    output += `  - Claimed: ${claimedCount} (${((100 * claimedCount) / links.length).toFixed(1)}%)\n`;
    output += `  - Unclaimed: ${unclaimedCount}\n\n`;
    output += `**Kernel Params:**\n`;
    output += `  - K_local: ${args.kLocal} DM speaker lines\n`;
    output += `  - Hill Curve: tau=${args.hillTau}, p=${args.hillSteepness}, betaLex=${args.betaLex}\n`;
    output += `  - Strong Min Strength: ${args.strongMinScore}\n`;
    output += `  - Weak Min Strength: ${args.weakMinScore}\n\n`;
    output += `---\n\n`;

    // Render links
    output += `## Claimed Links (${claimedCount})\n\n`;
    const claimed = links.filter((l) => l.claimed).sort((a, b) => a.intent_anchor_index - b.intent_anchor_index);
    for (const link of claimed) {
      output += render_link(link);
      const trace = traces?.find((t) => t.anchor_index === link.intent_anchor_index);
      if (trace && args.debugLinksDense) {
        output += render_trace(trace, transcript, true);
      }
      output += "\n";
    }

    output += `## Unclaimed Links (${unclaimedCount})\n\n`;
    const unclaimed = links.filter((l) => !l.claimed).sort((a, b) => a.intent_anchor_index - b.intent_anchor_index);
    for (const link of unclaimed) {
      output += render_link(link);
      const trace = traces?.find((t) => t.anchor_index === link.intent_anchor_index);
      if (trace && args.debugLinksDense) {
        output += render_trace(trace, transcript, true);
      }
      output += "\n";
    }

    // Write output
    if (args.output) {
      writeFileSync(args.output, output);
      console.error(`✓ Wrote ${args.output}`);
    } else {
      console.log(output);
    }

    console.error(`✓ Done`);
    process.exit(0);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}

main();
