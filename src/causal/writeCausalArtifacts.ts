import fs from "node:fs";
import path from "node:path";
import type { TranscriptEntry } from "../ledger/transcripts.js";
import type { CyclePhaseState, CausalCyclesProvenance } from "./cycleTypes.js";
import type { CausalLink } from "./types.js";

export interface WriteCausalArtifactsInput {
  sessionId: string;
  transcript: TranscriptEntry[];
  phases: CyclePhaseState[];
  provenance: CausalCyclesProvenance;
  outDir: string;
  runId?: string;
  outlineTopK: number;
  contextMaxLines: number;
  traceDepth: number;
  traceTopK: number;
  showIds?: boolean;
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function compactLink(link: CausalLink) {
  return {
    id: link.id,
    actor: link.actor,
    cause_anchor_index: link.cause_anchor_index ?? link.intent_anchor_index,
    effect_anchor_index: link.effect_anchor_index ?? link.consequence_anchor_index,
    strength_ce: link.strength_ce ?? link.score ?? null,
    strength: link.strength ?? link.strength_ce ?? link.score ?? null,
    mass_base: link.mass_base ?? null,
    mass: link.mass ?? link.link_mass ?? null,
    mass_boost: link.mass_boost ?? null,
    tier: link.tier ?? "link",
    claimed: link.claimed,
  };
}

function renderLinkSummary(link: CausalLink): string {
  const cause = link.cause_anchor_index ?? link.intent_anchor_index;
  const effect = link.effect_anchor_index ?? link.consequence_anchor_index;
  const strength = link.strength_ce ?? link.score ?? 0;
  const mass = link.mass ?? link.link_mass ?? link.mass_base ?? 0;
  const tier = link.tier ?? "link";
  return `Link ${link.id} (mass=${mass.toFixed(2)}, tier=${tier}) [cause@${cause} → effect@${effect ?? "?"}] strength_ce=${strength.toFixed(2)}`;
}

function renderTranscriptLine(entry: TranscriptEntry | undefined, lineIndex: number | null): string {
  if (!entry || lineIndex === null) {
    const label = typeof lineIndex === "number" ? `L${lineIndex}` : "L?";
    return `${label} [missing]`;
  }
  return `L${entry.line_index} (${entry.author_name}): "${entry.content}"`;
}

function formatLinkHeader(link: CausalLink, showIds: boolean): string {
  const strength = link.strength_ce ?? link.score ?? 0;
  const mass = link.mass ?? link.link_mass ?? link.mass_base ?? 0;
  const parts = [`Link mass=${mass.toFixed(2)}`, `strength=${strength.toFixed(2)}`];
  if (showIds) parts.push(`id=${link.id}`);
  return `[${parts.join(" | ")}]`;
}

function buildTranscriptOutline(
  phase: CyclePhaseState,
  transcript: TranscriptEntry[],
  outlineTopK: number,
  contextMaxLines: number,
  showIds: boolean,
): string {
  const transcriptByLine = new Map(transcript.map((line) => [line.line_index, line]));
  const contextByLinkId = new Map<string, number[]>();

  for (const edge of phase.contextEdges) {
    const arr = contextByLinkId.get(edge.link_id) ?? [];
    arr.push(edge.singleton_anchor_index);
    contextByLinkId.set(edge.link_id, arr);
  }

  const neighborsByTarget = new Map<string, typeof phase.neighborEdges>();
  for (const edge of phase.neighborEdges) {
    const arr = neighborsByTarget.get(edge.to_link_id) ?? [];
    arr.push(edge);
    neighborsByTarget.set(edge.to_link_id, arr);
  }

  const lines: string[] = [];
  lines.push(`# Cycle ${phase.cycle} Transcript Outline`);
  lines.push("");

  const linksById = new Map(phase.links.map((link) => [link.id, link]));
  const topLinks = [...phase.links]
    .sort((a, b) => (b.mass ?? 0) - (a.mass ?? 0))
    .slice(0, 20);

  for (const link of topLinks) {
    const causeIndex = link.cause_anchor_index ?? link.intent_anchor_index ?? null;
    const effectIndex = link.effect_anchor_index ?? link.consequence_anchor_index ?? null;
    const causeLine = typeof causeIndex === "number" ? transcriptByLine.get(causeIndex) : undefined;
    const effectLine = typeof effectIndex === "number" ? transcriptByLine.get(effectIndex) : undefined;

    lines.push(formatLinkHeader(link, showIds));
    lines.push(renderTranscriptLine(causeLine, causeIndex));
    if (typeof effectIndex === "number") {
      lines.push(`-> ${renderTranscriptLine(effectLine, effectIndex)}`);
    }

    const contextLines = (contextByLinkId.get(link.id) ?? [])
      .sort((a, b) => a - b)
      .slice(0, contextMaxLines);
    if (contextLines.length > 0) {
      lines.push("Absorbed context:");
      for (const idx of contextLines) {
        const entry = transcriptByLine.get(idx);
        lines.push(`- ${renderTranscriptLine(entry, idx)}`);
      }
    }

    const neighbors = (neighborsByTarget.get(link.id) ?? [])
      .sort((a, b) => b.strength_ll - a.strength_ll)
      .slice(0, outlineTopK);
    if (neighbors.length > 0) {
      lines.push("Nearby links (top by strength_ll):");
      for (const edge of neighbors) {
        const neighbor = linksById.get(edge.from_link_id);
        if (!neighbor) continue;
        const nCause = neighbor.cause_anchor_index ?? neighbor.intent_anchor_index ?? null;
        const nEffect = neighbor.effect_anchor_index ?? neighbor.consequence_anchor_index ?? null;
        const nMass = neighbor.mass ?? neighbor.link_mass ?? neighbor.mass_base ?? 0;
        const nCauseLabel = typeof nCause === "number" ? `L${nCause}` : "L?";
        const nEffectLabel = typeof nEffect === "number" ? `L${nEffect}` : "L?";
        lines.push(`- ${nCauseLabel} -> ${nEffectLabel} (mass ${nMass.toFixed(2)})`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

function buildAnnealTrace(
  phase: CyclePhaseState,
  traceDepth: number,
  traceTopK: number,
  contextMaxLines: number,
): string {
  const linksById = new Map(phase.links.map((l) => [l.id, l]));
  const neighborsByTarget = new Map<string, typeof phase.neighborEdges>();

  for (const edge of phase.neighborEdges) {
    const arr = neighborsByTarget.get(edge.to_link_id) ?? [];
    arr.push(edge);
    neighborsByTarget.set(edge.to_link_id, arr);
  }

  const lines: string[] = [];
  lines.push(`# Cycle ${phase.cycle} Anneal Trace`);
  lines.push("");

  const contextByLinkId = phase.contextByLinkId ?? new Map();

  const topLinks = [...phase.links]
    .sort((a, b) => (b.mass ?? 0) - (a.mass ?? 0))
    .slice(0, 20);

  const linkToLineLabel = (l: CausalLink): string => {
    const cause = l.cause_anchor_index ?? l.intent_anchor_index;
    const effect = l.effect_anchor_index ?? l.consequence_anchor_index;
    if (typeof cause !== "number") return "L?";
    if (typeof effect === "number" && effect !== cause) return `L${cause}–L${effect}`;
    return `L${cause}`;
  };

  const renderLink = (link: CausalLink, depth: number, indent: string, visited: Set<string>) => {
    const mass = link.mass ?? link.link_mass ?? link.mass_base ?? 0;
    const massBase = link.mass_base ?? link.link_mass ?? mass;
    const lineLabel = linkToLineLabel(link);
    const annealedPhrase = mass !== massBase ? ` annealed to ${mass.toFixed(2)}` : "";
    lines.push(`${indent}- ${lineLabel}${annealedPhrase}`);

    const context = contextByLinkId.get(link.id) ?? [];
    if (context.length > 0 && contextMaxLines > 0) {
      lines.push(`${indent}  - Context (attached singletons)`);
      for (const text of context.slice(0, contextMaxLines)) {
        lines.push(`${indent}    - ${text}`);
      }
    }

    if (depth >= traceDepth) return;

    const neighbors = (neighborsByTarget.get(link.id) ?? [])
      .sort((a, b) => b.contrib - a.contrib)
      .slice(0, traceTopK);

    if (neighbors.length > 0) {
      const neighborLines = neighbors
        .map((edge) => {
          const n = linksById.get(edge.from_link_id);
          return n ? linkToLineLabel(n) : edge.from_link_id;
        })
        .filter(Boolean);
      lines.push(`${indent}  - neighbors: ${neighborLines.join(", ")}`);
    }

    for (const edge of neighbors) {
      if (visited.has(edge.from_link_id)) continue;
      const neighbor = linksById.get(edge.from_link_id);
      if (neighbor) {
        const nextVisited = new Set(visited);
        nextVisited.add(edge.from_link_id);
        renderLink(neighbor, depth + 1, `${indent}  `, nextVisited);
      }
    }
  };

  for (const link of topLinks) {
    const visited = new Set<string>([link.id]);
    renderLink(link, 0, "", visited);
  }

  return lines.join("\n");
}

function renderMetricsMarkdown(metrics: CyclePhaseState["metrics"]): string {
  const lines: string[] = [];
  lines.push(`# Metrics`);
  lines.push("");
  lines.push(`- cycle: ${metrics.cycle}`);
  lines.push(`- phase: ${metrics.phase}`);
  lines.push(`- label: ${metrics.label}`);
  lines.push(`- timestamp_ms: ${metrics.timestamp_ms}`);
  lines.push("");
  lines.push(`## Counts`);
  for (const [key, value] of Object.entries(metrics.counts)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  lines.push(`## Stats`);
  for (const [key, value] of Object.entries(metrics.stats)) {
    lines.push(`- ${key}: min=${value.min.toFixed(2)} p50=${value.p50.toFixed(2)} p90=${value.p90.toFixed(2)} max=${value.max.toFixed(2)}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function writeCausalArtifacts(input: WriteCausalArtifactsInput): string {
  const runId = input.runId ?? `${Date.now()}_${input.provenance.param_hash}`;
  const runDir = path.join(input.outDir, input.sessionId, runId);
  ensureDir(runDir);

  const summary = {
    session_id: input.sessionId,
    run_id: runId,
    provenance: input.provenance,
    phases: input.phases.map((phase) => ({
      cycle: phase.cycle,
      phase: phase.phase,
      counts: phase.metrics.counts,
      stats: phase.metrics.stats,
    })),
  };
  writeJson(path.join(runDir, "summary.json"), summary);

  const summaryLines: string[] = [
    `# Causal Cycle Summary`,
    ``,
    `- session_id: ${input.sessionId}`,
    `- run_id: ${runId}`,
    `- kernel_version: ${input.provenance.kernel_version}`,
    `- param_hash: ${input.provenance.param_hash}`,
    ``,
  ];
  fs.writeFileSync(path.join(runDir, "summary.md"), summaryLines.join("\n"), "utf8");

  for (const phase of input.phases) {
    const phaseDir = path.join(runDir, `cycle${phase.cycle}`, phase.phase);
    ensureDir(phaseDir);

    writeJson(path.join(phaseDir, "metrics.json"), phase.metrics);
    fs.writeFileSync(path.join(phaseDir, "metrics.md"), renderMetricsMarkdown(phase.metrics), "utf8");
    writeJson(path.join(phaseDir, "links.json"), phase.links.map(compactLink));

    if (phase.phase === "link") {
      writeJson(path.join(phaseDir, "context_edges.json"), phase.contextEdges);
      writeJson(path.join(phaseDir, "singletons.json"), {
        singleton_causes: phase.singletonCauses,
        singleton_effects: phase.singletonEffects,
      });
    }

    if (phase.phase === "anneal") {
      writeJson(path.join(phaseDir, "neighbor_edges.json"), phase.neighborEdges);
      if (phase.massDeltaTsv) {
        fs.writeFileSync(path.join(phaseDir, "mass_delta.tsv"), phase.massDeltaTsv, "utf8");
      }
      const transcriptOutline = buildTranscriptOutline(
        phase,
        input.transcript,
        input.outlineTopK,
        input.contextMaxLines,
        input.showIds ?? false,
      );
      fs.writeFileSync(path.join(phaseDir, "outline.transcript.md"), transcriptOutline, "utf8");

      const annealTrace = buildAnnealTrace(
        phase,
        input.traceDepth,
        input.traceTopK,
        input.contextMaxLines,
      );
      fs.writeFileSync(path.join(phaseDir, "outline.anneal-trace.md"), annealTrace, "utf8");
    }
  }

  return runDir;
}
