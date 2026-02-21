import fs from "node:fs";
import path from "node:path";
import type { TranscriptEntry } from "../ledger/transcripts.js";
import type { RoundPhaseState } from "./hierarchyTypes.js";
import type { CausalLink } from "./types.js";

import { renderHierarchyOutline, renderHierarchySpansOutline } from "./renderHierarchyOutline.js";
import { renderTimelineOutline } from "./renderTimelineOutline.js";

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function writeTsv(filePath: string, rows: Array<Record<string, unknown>>): void {
  if (rows.length === 0) {
    fs.writeFileSync(filePath, "", "utf8");
    return;
  }
  const keys = Object.keys(rows[0]);
  const lines = [keys.join("\t")];
  for (const row of rows) {
    const values = keys.map((key) => {
      const val = row[key];
      if (val === null || val === undefined) return "";
      if (typeof val === "string") return val;
      if (typeof val === "number") return val.toFixed(6);
      return String(val);
    });
    lines.push(values.join("\t"));
  }
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

export function writeHierarchyArtifacts(input: {
  sessionId: string;
  sessionLabel?: string;
  transcript: TranscriptEntry[];
  allRounds: RoundPhaseState[];
  provenance: { kernel_version: string; params_json: string; param_hash: string };
  outDir: string;
  runId?: string;
  outlineTopK: number;
}): string {
  const runId = input.runId ?? `${Date.now()}_${input.provenance.param_hash}`;
  const safeLabel = (input.sessionLabel ?? "").trim().replace(/[<>:\"/\\|?*\x00-\x1F]/g, "_");
  const sessionDir = safeLabel.length > 0 ? safeLabel : input.sessionId;
  const runDir = path.join(input.outDir, sessionDir, runId);
  ensureDir(runDir);

  const maxRound = Math.max(...input.allRounds.map((r) => r.round), 1);

  const rounds = Array.from(new Set(input.allRounds.map((phase) => phase.round))).sort((a, b) => a - b);
  const allNodeMap = new Map<string, CausalLink>();
  for (const phase of input.allRounds) {
    for (const node of phase.nodes) {
      if (!allNodeMap.has(node.id)) allNodeMap.set(node.id, node);
    }
  }

  for (const roundNumber of rounds) {
    const roundRoot = path.join(runDir, `round${roundNumber}`);
    const linkState = input.allRounds.find((phase) => phase.round === roundNumber && phase.phase === "link");
    const annealState = input.allRounds.find((phase) => phase.round === roundNumber && phase.phase === "anneal");
    if (!linkState || !annealState) continue;

    const linkDir = path.join(roundRoot, "link");
    const annealDir = path.join(roundRoot, "anneal");
    ensureDir(linkDir);
    ensureDir(annealDir);

    writeJson(path.join(linkDir, "metrics.json"), linkState.metrics);
    writeJson(path.join(annealDir, "metrics.json"), annealState.metrics);

    if (roundNumber === 1) {
      writeJson(path.join(linkDir, "links.json"), linkState.nodes);
      writeJson(path.join(linkDir, "traces.json"), linkState.candidates ?? []);
    } else {
      writeJson(path.join(linkDir, "nodes.json"), linkState.nodes);
      writeJson(path.join(linkDir, "pair_traces.json"), linkState.candidates ?? []);
      const chosenPairs = (linkState.candidates ?? [])
        .filter((c) => c.chosen)
        .map((c) => ({
          left_id: c.left_id,
          right_id: c.right_id,
          left_center: c.left_center,
          right_center: c.right_center,
          center_distance: c.center_distance,
          lexical_score: c.lexical_score,
          strength_bridge: c.strength_bridge,
        }));
      writeTsv(path.join(linkDir, "pairs.tsv"), chosenPairs);
    }

    writeTsv(
      path.join(annealDir, "neighbor_edges.tsv"),
      annealState.neighborEdges.map((edge) => ({
        from_link_id: edge.from_link_id,
        to_link_id: edge.to_link_id,
        strength_ll: edge.strength_ll,
        contrib: edge.contrib,
        distance: edge.distance,
        lexical: edge.lexical,
      })),
    );
    fs.writeFileSync(path.join(annealDir, "deltas.tsv"), annealState.massDeltaTsv ?? "", "utf8");

    const topk = renderHierarchyOutline({
      nodes: annealState.nodes,
      transcript: input.transcript,
      topK: input.outlineTopK,
      filterMode: "composites_only",
      fullNodeMap: allNodeMap,
      maxDepth: 3,
    });
    fs.writeFileSync(path.join(roundRoot, "outline.topk.md"), topk, "utf8");

    const timeline = renderTimelineOutline({
      nodes: annealState.nodes,
      transcript: input.transcript,
      fullNodeMap: allNodeMap,
    });
    fs.writeFileSync(path.join(roundRoot, "outline.timeline.md"), timeline, "utf8");

    const spans = renderHierarchySpansOutline({
      nodes: annealState.nodes,
      transcript: input.transcript,
      fullNodeMap: allNodeMap,
    });
    fs.writeFileSync(path.join(roundRoot, "outline.spans.md"), spans, "utf8");

    const roundIndex = [
      `# Round ${roundNumber}`,
      ``,
      `- [Top-K Outline](./outline.topk.md)`,
      `- [Timeline Outline](./outline.timeline.md)`,
      `- [Spans Outline](./outline.spans.md)`,
      `- [Link Metrics](./link/metrics.json)`,
      `- [Anneal Metrics](./anneal/metrics.json)`,
      `- [Anneal Deltas](./anneal/deltas.tsv)`,
      `- [Neighbor Edges](./anneal/neighbor_edges.tsv)`,
      roundNumber === 1 ? `- [Links](./link/links.json)` : `- [Nodes](./link/nodes.json)`,
      roundNumber === 1 ? `- [Traces](./link/traces.json)` : `- [Pairs](./link/pairs.tsv)`,
      roundNumber === 1 ? `` : `- [Pair Traces](./link/pair_traces.json)`,
      ``,
    ];
    fs.writeFileSync(path.join(roundRoot, "index.md"), roundIndex.join("\n"), "utf8");
  }

  // Write final summary
  const summary = {
    session_id: input.sessionId,
    run_id: runId,
    provenance: input.provenance,
    max_round: maxRound,
    total_phases: input.allRounds.length,
    rounds: input.allRounds.map((phase) => ({
      round: phase.round,
      phase: phase.phase,
      counts: phase.metrics.counts,
      stats: phase.metrics.stats,
    })),
  };
  writeJson(path.join(runDir, "summary.json"), summary);
  writeJson(path.join(runDir, "params.json"), JSON.parse(input.provenance.params_json));

  const summaryMd = [
    `# Causal Hierarchy Summary`,
    ``,
    `- session_id: ${input.sessionId}`,
    `- run_id: ${runId}`,
    `- kernel_version: ${input.provenance.kernel_version}`,
    `- param_hash: ${input.provenance.param_hash}`,
    `- max_round: ${maxRound}`,
    ``,
    `## Rounds`,
    ``,
    ...input.allRounds
      .filter((r) => r.phase === "link" || (r.phase === "anneal" && r.round === maxRound))
      .map((r) => `- Round ${r.round}/${r.phase}: ${Object.entries(r.metrics.counts).map(([k, v]) => `${k}=${v}`).join(" ")}`),
  ];
  fs.writeFileSync(path.join(runDir, "summary.md"), summaryMd.join("\n"), "utf8");

  const finalRound = Math.max(...rounds);
  const finalDir = path.join(runDir, "final");
  ensureDir(finalDir);
  const finalAnneal = input.allRounds.find((phase) => phase.round === finalRound && phase.phase === "anneal");

  if (finalAnneal) {
    const finalTopk = renderHierarchyOutline({
      nodes: finalAnneal.nodes,
      transcript: input.transcript,
      topK: input.outlineTopK,
      filterMode: "composites_only",
      fullNodeMap: allNodeMap,
      maxDepth: 3,
    });
    fs.writeFileSync(path.join(runDir, "output.topk.md"), finalTopk, "utf8");

    const finalTimeline = renderTimelineOutline({
      nodes: finalAnneal.nodes,
      transcript: input.transcript,
      fullNodeMap: allNodeMap,
    });
    fs.writeFileSync(path.join(runDir, "output.timeline.md"), finalTimeline, "utf8");

    const finalSpans = renderHierarchySpansOutline({
      nodes: finalAnneal.nodes,
      transcript: input.transcript,
      fullNodeMap: allNodeMap,
    });
    fs.writeFileSync(path.join(runDir, "output.spans.md"), finalSpans, "utf8");
  }

  const finalOutlinePath = path.join(runDir, `round${finalRound}`, "outline.topk.md");
  if (fs.existsSync(finalOutlinePath)) {
    fs.copyFileSync(finalOutlinePath, path.join(finalDir, "outline.md"));
  } else {
    fs.writeFileSync(path.join(finalDir, "outline.md"), "# Final Outline\n", "utf8");
  }

  const rootIndex = [
    `# Causal Hierarchy Run`,
    ``,
    `- session_id: ${input.sessionId}`,
    `- run_id: ${runId}`,
    `- kernel_version: ${input.provenance.kernel_version}`,
    `- param_hash: ${input.provenance.param_hash}`,
    ``,
    `## Root Files`,
    `- [Summary JSON](./summary.json)`,
    `- [Summary Markdown](./summary.md)`,
    `- [Params](./params.json)`,
    `- [Final Outline](./final/outline.md)`,
    `- [Output TopK](./output.topk.md)`,
    `- [Output Timeline](./output.timeline.md)`,
    `- [Output Spans](./output.spans.md)`,
    ``,
    `## Rounds`,
    ...rounds.map((round) => `- [Round ${round}](./round${round}/index.md)`),
    ``,
  ];
  fs.writeFileSync(path.join(runDir, "INDEX.md"), rootIndex.join("\n"), "utf8");

  return runDir;
}
