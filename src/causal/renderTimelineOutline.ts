import type { TranscriptEntry } from "../ledger/transcripts.js";
import type { CausalLink } from "./types.js";

type SpanItem = {
  id: string;
  level: number;
  kind: string;
  start: number;
  end: number;
  center: number;
  mass: number;
  strength: number;
  parent_id: string | null;
  absorbed_singleton_anchors: number[];
};

function fmtCenter(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function inferKind(node: CausalLink): string {
  if (node.node_kind) return node.node_kind;
  if ((node.level ?? 1) >= 2 && Array.isArray(node.members) && node.members.length === 2) return "composite";
  const hasEffect = typeof (node.effect_anchor_index ?? node.consequence_anchor_index) === "number";
  return hasEffect && node.claimed ? "link" : "singleton";
}

function getSpan(link: CausalLink): { start: number; end: number } {
  const start = link.span_start_index ?? link.cause_anchor_index ?? link.intent_anchor_index ?? 0;
  const end = link.span_end_index ?? link.effect_anchor_index ?? link.consequence_anchor_index ?? start;
  return { start, end };
}

function renderTranscriptLine(entry: TranscriptEntry): string {
  return `L${entry.line_index} (${entry.author_name}): "${entry.content}"`;
}

export function renderTimelineOutline(input: {
  nodes: CausalLink[];
  transcript: TranscriptEntry[];
  fullNodeMap?: Map<string, CausalLink>;
  includeMeta?: boolean;
}): string {
  const nodeById = input.fullNodeMap ?? new Map(input.nodes.map((node) => [node.id, node]));

  const collectDescendants = (root: CausalLink, out: Map<string, CausalLink>, seen: Set<string>): void => {
    if (seen.has(root.id)) return;
    seen.add(root.id);
    out.set(root.id, root);
    if (!root.members || root.members.length !== 2) return;
    for (const childId of root.members) {
      const child = nodeById.get(childId);
      if (!child) continue;
      collectDescendants(child, out, seen);
    }
  };

  const relevantNodes = new Map<string, CausalLink>();
  const seen = new Set<string>();
  for (const node of input.nodes) {
    collectDescendants(node, relevantNodes, seen);
  }
  const renderNodes = Array.from(relevantNodes.values());

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
      for (const value of collectSingletonAnchors(child, visiting)) {
        anchors.add(value);
      }
    }

    const resolved = Array.from(anchors).sort((a, b) => a - b);
    singletonAnchorsByNodeId.set(node.id, resolved);
    visiting.delete(node.id);
    return resolved;
  };

  const parentById = new Map<string, string | null>();
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
      if (parentLen < currentLen) {
        parentById.set(memberId, node.id);
      }
    }
  }

  const spans: SpanItem[] = renderNodes
    .filter((node) => {
      const level = node.level ?? 1;
      if (level >= 2) return Array.isArray(node.members) && node.members.length === 2;
      const hasEffect = typeof (node.effect_anchor_index ?? node.consequence_anchor_index) === "number";
      const isCompositeMember = parentById.has(node.id);
      return level === 1 && (hasEffect || isCompositeMember);
    })
    .map((node) => {
      const span = getSpan(node);
      const level = node.level ?? 1;
      const center = node.center_index ?? (span.start + span.end) / 2;
      const mass = node.mass ?? node.link_mass ?? node.mass_base ?? 0;
      const strength = node.strength_internal ?? node.strength_bridge ?? node.strength_ce ?? node.score ?? 0;
      return {
        id: node.id,
        level,
        kind: inferKind(node),
        start: span.start,
        end: span.end,
        center,
        mass,
        strength,
        parent_id: parentById.get(node.id) ?? null,
        absorbed_singleton_anchors:
          inferKind(node) === "composite" ? collectSingletonAnchors(node, new Set<string>()) : [],
      };
    })
    .sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      if (b.level !== a.level) return b.level - a.level;
      const lenA = a.end - a.start;
      const lenB = b.end - b.start;
      if (lenB !== lenA) return lenB - lenA;
      if (a.center !== b.center) return a.center - b.center;
      return a.id.localeCompare(b.id);
    });

  const starts = new Map<number, SpanItem[]>();
  for (const span of spans) {
    const arr = starts.get(span.start) ?? [];
    arr.push(span);
    starts.set(span.start, arr);
  }

  for (const arr of starts.values()) {
    arr.sort((a, b) => {
      const aHasParent = a.parent_id ? 1 : 0;
      const bHasParent = b.parent_id ? 1 : 0;
      if (aHasParent !== bHasParent) return aHasParent - bHasParent;
      if (b.level !== a.level) return b.level - a.level;
      const lenA = a.end - a.start;
      const lenB = b.end - b.start;
      if (lenB !== lenA) return lenB - lenA;
      if (a.center !== b.center) return a.center - b.center;
      return a.id.localeCompare(b.id);
    });
  }

  const lines: string[] = ["# Timeline Outline", ""];

  let active: SpanItem[] = [];
  const activeById = new Set<string>();
  const spanById = new Map(spans.map((span) => [span.id, span]));

  const countHigherActiveLevels = (level: number): number => {
    const levels = new Set<number>();
    for (const span of active) {
      if (span.level > level) levels.add(span.level);
    }
    return levels.size;
  };

  const countActiveAncestors = (span: SpanItem): number => {
    let count = 0;
    let parentId = span.parent_id;
    const visited = new Set<string>();
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      if (activeById.has(parentId)) {
        count += 1;
      }
      const parent = spanById.get(parentId);
      parentId = parent?.parent_id ?? null;
    }
    return count;
  };

  const getActiveHierarchyDepth = (): number => {
    const levels = new Set<number>();
    for (const span of active) levels.add(span.level);
    return levels.size;
  };

  for (const entry of input.transcript) {
    active = active.filter((span) => span.end >= entry.line_index);
    activeById.clear();
    for (const span of active) activeById.add(span.id);

    const opening = starts.get(entry.line_index) ?? [];
    for (const span of opening) {
      const indentDepth = Math.max(countActiveAncestors(span), countHigherActiveLevels(span.level));
      const indent = "  ".repeat(indentDepth);
      const singletonDebug =
        span.absorbed_singleton_anchors.length > 0
          ? ` absorbed_singletons=[${span.absorbed_singleton_anchors.map((line) => `L${line}`).join(", ")}]`
          : "";
      lines.push(
        `${indent}- [L${span.level} ${span.kind} m=${span.mass.toFixed(2)} s=${span.strength.toFixed(2)} span L${span.start}–L${span.end} center=L${fmtCenter(span.center)}${singletonDebug}]`,
      );
      active.push(span);
      activeById.add(span.id);
    }

    const indent = "  ".repeat(getActiveHierarchyDepth());
    lines.push(`${indent}- ${renderTranscriptLine(entry)}`);

    active = active.filter((span) => span.end > entry.line_index);
    activeById.clear();
    for (const span of active) activeById.add(span.id);
  }

  lines.push("");
  return lines.join("\n");
}
