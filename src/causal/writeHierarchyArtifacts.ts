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

function buildAnnealRoundsByNodeId(allRounds: RoundPhaseState[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const rounds = Array.from(new Set(allRounds.map((r) => r.round))).sort((a, b) => a - b);
  for (const round of rounds) {
    const linkPhase = allRounds.find((p) => p.round === round && p.phase === "link");
    const annealPhase = allRounds.find((p) => p.round === round && p.phase === "anneal");
    if (!linkPhase || !annealPhase) continue;
    const linkById = new Map(linkPhase.nodes.map((n) => [n.id, n]));
    for (const node of annealPhase.nodes) {
      const prev = linkById.get(node.id);
      const prevCtxCount = prev?.context_line_indices?.length ?? 0;
      const nextCtxCount = node.context_line_indices?.length ?? 0;
      const prevMass = prev?.mass ?? prev?.link_mass ?? prev?.mass_base ?? 0;
      const nextMass = node.mass ?? node.link_mass ?? node.mass_base ?? prevMass;
      const changedThisRound = nextCtxCount > prevCtxCount || nextMass > prevMass;
      if (!changedThisRound) continue;
      const nodeRounds = out.get(node.id) ?? [];
      if (!nodeRounds.includes(round)) nodeRounds.push(round);
      nodeRounds.sort((a, b) => a - b);
      out.set(node.id, nodeRounds);
    }
  }
  return out;
}

function buildLineAnnealAnnotations(input: {
  nodes: CausalLink[];
  fullNodeMap: Map<string, CausalLink>;
  annealRoundsByNodeId: Map<string, number[]>;
}): Array<{ line_index: number; target_center: number; anneal_rounds: number[] }> {
  const nodeById = input.fullNodeMap;
  const relevant = new Map<string, CausalLink>();
  const seen = new Set<string>();

  const collectDescendants = (root: CausalLink): void => {
    if (seen.has(root.id)) return;
    seen.add(root.id);
    relevant.set(root.id, root);
    if (!root.members || root.members.length !== 2) return;
    for (const childId of root.members) {
      const child = nodeById.get(childId);
      if (child) collectDescendants(child);
    }
  };

  for (const node of input.nodes) collectDescendants(node);
  const renderNodes = Array.from(relevant.values());

  const parentById = new Map<string, string | null>();
  const inferKind = (node: CausalLink): "composite" | "link" | "singleton" => {
    if (node.node_kind === "composite") return "composite";
    if (node.node_kind === "singleton") return "singleton";
    if (node.node_kind === "link") return "link";
    if ((node.level ?? 1) >= 2 && Array.isArray(node.members) && node.members.length === 2) return "composite";
    const hasEffect = typeof (node.effect_anchor_index ?? node.consequence_anchor_index) === "number";
    return hasEffect && node.claimed ? "link" : "singleton";
  };
  const getSpan = (n: CausalLink): { start: number; end: number } => {
    const start = n.span_start_index ?? n.cause_anchor_index ?? n.intent_anchor_index ?? 0;
    const end = n.span_end_index ?? n.effect_anchor_index ?? n.consequence_anchor_index ?? start;
    return { start, end };
  };
  for (const node of renderNodes) {
    if (!node.members || node.members.length !== 2) continue;
    const parentSpan = getSpan(node);
    const parentLen = parentSpan.end - parentSpan.start;
    for (const memberId of node.members) {
      const child = nodeById.get(memberId);
      if (!child) continue;
      const currentParentId = parentById.get(memberId);
      if (!currentParentId) {
        parentById.set(memberId, node.id);
        continue;
      }
      const currentParent = nodeById.get(currentParentId);
      if (!currentParent) {
        parentById.set(memberId, node.id);
        continue;
      }
      const currentSpan = getSpan(currentParent);
      const currentLen = currentSpan.end - currentSpan.start;
      if (parentLen < currentLen) parentById.set(memberId, node.id);
    }
  }

  const singletonAnchorsByNodeId = new Map<string, number[]>();
  const collectSingletonAnchors = (node: CausalLink, visiting: Set<string>): number[] => {
    const cached = singletonAnchorsByNodeId.get(node.id);
    if (cached) return cached;
    if (visiting.has(node.id)) return [];
    visiting.add(node.id);

    const kind = inferKind(node);
    if (kind === "singleton") {
      const anchor = node.cause_anchor_index ?? node.intent_anchor_index ?? node.span_start_index;
      const anchors = typeof anchor === "number" ? [anchor] : [];
      singletonAnchorsByNodeId.set(node.id, anchors);
      visiting.delete(node.id);
      return anchors;
    }

    if (!node.members || node.members.length !== 2) {
      singletonAnchorsByNodeId.set(node.id, []);
      visiting.delete(node.id);
      return [];
    }

    const anchors = new Set<number>();
    for (const childId of node.members) {
      const child = nodeById.get(childId);
      if (!child) continue;
      for (const value of collectSingletonAnchors(child, visiting)) anchors.add(value);
    }

    const resolved = Array.from(anchors).sort((a, b) => a - b);
    singletonAnchorsByNodeId.set(node.id, resolved);
    visiting.delete(node.id);
    return resolved;
  };

  const out = new Map<number, { target_center: number; rounds: Set<number> }>();
  for (const node of renderNodes) {
    const level = node.level ?? 1;
    const hasEffect = typeof (node.effect_anchor_index ?? node.consequence_anchor_index) === "number";
    const isCompositeMember = parentById.has(node.id);
    const shouldRender = (level >= 2 && Array.isArray(node.members) && node.members.length === 2) || (level === 1 && (hasEffect || isCompositeMember));
    if (!shouldRender) continue;

    const rounds = input.annealRoundsByNodeId.get(node.id) ?? [];
    const base = node.mass_base ?? node.link_mass ?? node.mass ?? 0;
    const mass = node.mass ?? node.link_mass ?? base;
    const boost = node.mass_boost ?? 0;
    const annealed = rounds.length > 0 || boost > 0 || mass > base;
    if (!annealed) continue;

    const sourceLines = new Set<number>();
    // Match timeline renderer behavior: use recursively-derived absorbed singleton anchors for composites.
    if (inferKind(node) === "composite") {
      for (const idx of collectSingletonAnchors(node, new Set<string>())) sourceLines.add(idx);
    }
    for (const idx of node.context_line_indices ?? []) sourceLines.add(idx);
    if (sourceLines.size === 0) continue;

    const center = node.center_index ?? ((getSpan(node).start + getSpan(node).end) / 2);
    for (const idx of sourceLines) {
      const cur = out.get(idx) ?? { target_center: center, rounds: new Set<number>() };
      // Match timeline renderer behavior: first-seen target center wins for display.
      if (!out.has(idx)) {
        cur.target_center = center;
      }
      for (const r of rounds) cur.rounds.add(r);
      out.set(idx, cur);
    }
  }

  return Array.from(out.entries())
    .map(([line_index, v]) => ({
      line_index,
      target_center: v.target_center,
      anneal_rounds: Array.from(v.rounds).sort((a, b) => a - b),
    }))
    .sort((a, b) => a.line_index - b.line_index);
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
  const annealRoundsByNodeId = buildAnnealRoundsByNodeId(input.allRounds);
  // Last occurrence wins so we get post-anneal state (mass, mass_boost) for leaves and composites
  const allNodeMap = new Map<string, CausalLink>();
  for (const phase of input.allRounds) {
    for (const node of phase.nodes) {
      allNodeMap.set(node.id, node);
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
          threshold_link: c.threshold_link,
        }));
      writeTsv(path.join(linkDir, "pairs.tsv"), chosenPairs);
    }

    writeTsv(path.join(annealDir, "neighbor_edges.tsv"), []);
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
      annealRoundsByNodeId,
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
      `- [Absorption Metrics](./anneal/metrics.json)`,
      `- [Absorption Deltas](./anneal/deltas.tsv)`,
      `- [Absorption Neighbor Edges (legacy/unused)](./anneal/neighbor_edges.tsv)`,
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
      .map((r) => `- Round ${r.round}/${r.phase === "anneal" ? "absorption" : r.phase}: ${Object.entries(r.metrics.counts).map(([k, v]) => `${k}=${v}`).join(" ")}`),
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
      annealRoundsByNodeId,
    });
    fs.writeFileSync(path.join(runDir, "output.timeline.md"), finalTimeline, "utf8");

    const finalSpans = renderHierarchySpansOutline({
      nodes: finalAnneal.nodes,
      transcript: input.transcript,
      fullNodeMap: allNodeMap,
    });
    fs.writeFileSync(path.join(runDir, "output.spans.md"), finalSpans, "utf8");

    const finalLineAnneals = buildLineAnnealAnnotations({
      nodes: finalAnneal.nodes,
      fullNodeMap: allNodeMap,
      annealRoundsByNodeId,
    });
    const absorptionPayload = {
      count: finalLineAnneals.length,
      line_annotations: finalLineAnneals,
    };
    writeJson(path.join(runDir, "output.absorptions.json"), absorptionPayload);
    // Backward-compatibility alias for existing debug tooling.
    writeJson(path.join(runDir, "output.anneals.json"), absorptionPayload);
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
    `- [Output Absorptions](./output.absorptions.json)`,
    ``,
    `## Rounds`,
    ...rounds.map((round) => `- [Round ${round}](./round${round}/index.md)`),
    ``,
  ];
  fs.writeFileSync(path.join(runDir, "INDEX.md"), rootIndex.join("\n"), "utf8");

  return runDir;
}
