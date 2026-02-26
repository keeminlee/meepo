import type { TranscriptEntry } from "../ledger/transcripts.js";
import type { CausalLink } from "./types.js";

function renderTranscriptLine(entry: TranscriptEntry | undefined, lineIndex: number | null): string {
  if (!entry || lineIndex === null) {
    const label = typeof lineIndex === "number" ? `L${lineIndex}` : "L?";
    return `${label} [missing]`;
  }
  return `L${entry.line_index} (${entry.author_name}): "${entry.content}"`;
}

function getSpan(link: CausalLink): { start: number; end: number } {
  const start = link.span_start_index ?? link.cause_anchor_index ?? link.intent_anchor_index ?? 0;
  const end = link.span_end_index ?? link.effect_anchor_index ?? link.consequence_anchor_index ?? start;
  return { start, end };
}

function fmtCenter(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function fmtKind(node: CausalLink): string {
  if (node.node_kind) return ` ${node.node_kind}`;
  if ((node.level ?? 1) >= 2 && Array.isArray(node.members) && node.members.length === 2) return " composite";
  const hasEffect = typeof (node.effect_anchor_index ?? node.consequence_anchor_index) === "number";
  return hasEffect && node.claimed ? " link" : " singleton";
}

type FilterMode = "composites_only" | "all_nodes";

function getNodeMap(nodes: CausalLink[], fullNodeMap?: Map<string, CausalLink>): Map<string, CausalLink> {
  if (fullNodeMap) return fullNodeMap;
  return new Map(nodes.map((node) => [node.id, node]));
}

function isComposite(node: CausalLink): boolean {
  return (node.level ?? 1) >= 2 && Array.isArray(node.members) && node.members.length === 2;
}

function toLeafCandidates(nodes: CausalLink[]): CausalLink[] {
  return nodes.filter((node) => (node.level ?? 1) === 1);
}

function selectTopNodes(nodes: CausalLink[], topK: number, filterMode: FilterMode): CausalLink[] {
  const byMass = (a: CausalLink, b: CausalLink) => (b.mass ?? 0) - (a.mass ?? 0);
  if (filterMode === "all_nodes") {
    return [...nodes].sort(byMass).slice(0, topK);
  }

  const composites = nodes.filter(isComposite).sort(byMass);
  if (composites.length >= topK) return composites.slice(0, topK);

  const leaves = toLeafCandidates(nodes)
    .filter((node) => (node.span_start_index ?? node.cause_anchor_index ?? node.intent_anchor_index ?? 0) !== (node.span_end_index ?? node.effect_anchor_index ?? node.consequence_anchor_index ?? node.cause_anchor_index ?? node.intent_anchor_index ?? 0))
    .sort(byMass);
  return [...composites, ...leaves].slice(0, topK);
}

function renderExpandedNode(params: {
  node: CausalLink;
  nodeMap: Map<string, CausalLink>;
  transcriptByLine: Map<number, TranscriptEntry>;
  lines: string[];
  indent: string;
  depth: number;
  maxDepth: number;
  seenIds: Set<string>;
  includeMeta?: boolean;
}): void {
  const { node, nodeMap, transcriptByLine, lines, indent, depth, maxDepth, seenIds } = params;
  if (depth > maxDepth || seenIds.has(node.id)) return;
  seenIds.add(node.id);

  const level = node.level ?? 1;
  const mass = node.mass ?? node.link_mass ?? node.mass_base ?? 0;
  const massBase = node.mass_base ?? node.link_mass ?? mass;
  const strengthInternal = node.strength_internal ?? node.strength_bridge ?? node.strength_ce ?? node.score ?? 0;
  const span = getSpan(node);
  const center = node.center_index ?? (span.start + span.end) / 2;
  const annealedPhrase = level === 1 && fmtKind(node).trim() === "link" && mass !== massBase ? ` absorbed_mass=${mass.toFixed(2)}` : "";

  lines.push(`${indent}- [L${level}${fmtKind(node)} m=${mass.toFixed(2)} s=${strengthInternal.toFixed(2)} span L${span.start}–L${span.end} center=L${fmtCenter(center)}${annealedPhrase}]`);

  if (isComposite(node) && typeof node.join_center_distance === "number" && typeof node.join_lexical_score === "number") {
    lines.push(
      `${indent}  - join: dCenter=${fmtCenter(node.join_center_distance)} lex=${node.join_lexical_score.toFixed(2)} bridge=${(node.strength_bridge ?? 0).toFixed(2)}`,
    );
  }

  if (level <= 1) {
    const causeIndex = node.cause_anchor_index ?? node.intent_anchor_index ?? null;
    const effectIndex = node.effect_anchor_index ?? node.consequence_anchor_index ?? null;
    const causeLine = typeof causeIndex === "number" ? transcriptByLine.get(causeIndex) : undefined;
    const effectLine = typeof effectIndex === "number" ? transcriptByLine.get(effectIndex) : undefined;
    lines.push(`${indent}  - ${renderTranscriptLine(causeLine, causeIndex)}`);
    if (typeof effectIndex === "number") {
      lines.push(`${indent}  - ${renderTranscriptLine(effectLine, effectIndex)}`);
    }
    for (const ctxIndex of node.context_line_indices ?? []) {
      const ctxEntry = transcriptByLine.get(ctxIndex);
      lines.push(`${indent}    - ctx ${renderTranscriptLine(ctxEntry, ctxIndex)}`);
    }
    return;
  }

  if (!node.members || node.members.length !== 2) return;
  const [leftId, rightId] = node.members;
  const left = nodeMap.get(leftId);
  const right = nodeMap.get(rightId);
  if (left) {
    renderExpandedNode({
      node: left,
      nodeMap,
      transcriptByLine,
      lines,
      indent: `${indent}  `,
      depth: depth + 1,
      maxDepth,
      seenIds: new Set(seenIds),
      includeMeta: params.includeMeta,
    });
  }
  if (right) {
    renderExpandedNode({
      node: right,
      nodeMap,
      transcriptByLine,
      lines,
      indent: `${indent}  `,
      depth: depth + 1,
      maxDepth,
      seenIds: new Set(seenIds),
      includeMeta: params.includeMeta,
    });
  }
}

export function renderHierarchyOutline(input: {
  nodes: CausalLink[];
  transcript: TranscriptEntry[];
  topK: number;
  filterMode?: FilterMode;
  fullNodeMap?: Map<string, CausalLink>;
  maxDepth?: number;
  includeMeta?: boolean;
}): string {
  const transcriptByLine = new Map(input.transcript.map((line) => [line.line_index, line]));
  const nodeById = getNodeMap(input.nodes, input.fullNodeMap);
  const filterMode = input.filterMode ?? "composites_only";
  const maxDepth = input.maxDepth ?? 3;
  const topNodes = selectTopNodes(input.nodes, input.topK, filterMode);

  const lines: string[] = [];
  lines.push(`# Hierarchy Outline (Top ${input.topK}, mode=${filterMode})`);
  lines.push("");

  for (const node of topNodes) {
    renderExpandedNode({
      node,
      nodeMap: nodeById,
      transcriptByLine,
      lines,
      indent: "",
      depth: 0,
      maxDepth,
      seenIds: new Set<string>(),
      includeMeta: input.includeMeta,
    });
    lines.push("");
  }

  if (topNodes.length === 0) {
    lines.push("- No nodes available for this mode.");
    lines.push("");
  }

  return lines.join("\n");
}

export function renderHierarchySpansOutline(input: {
  nodes: CausalLink[];
  transcript: TranscriptEntry[];
  fullNodeMap?: Map<string, CausalLink>;
}): string {
  const transcriptByLine = new Map(input.transcript.map((line) => [line.line_index, line]));
  const nodeById = getNodeMap(input.nodes, input.fullNodeMap);
  const composites = input.nodes
    .filter(isComposite)
    .sort((a, b) => (b.mass ?? 0) - (a.mass ?? 0));

  const lines: string[] = ["# Composite Spans", ""];
  for (const node of composites) {
    lines.push("---");
    renderExpandedNode({
      node,
      nodeMap: nodeById,
      transcriptByLine,
      lines,
      indent: "",
      depth: 0,
      maxDepth: 3,
      seenIds: new Set<string>(),
    });
    const span = getSpan(node);
    lines.push(`- covered_range: L${span.start}..L${span.end}`);
    lines.push("");
  }

  if (composites.length === 0) {
    lines.push("- No composite nodes in this round.");
    lines.push("");
  }

  return lines.join("\n");
}
