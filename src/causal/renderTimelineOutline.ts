import type { TranscriptEntry } from "../ledger/transcripts.js";
import type { CausalLink } from "./types.js";

type SpanItem = {
  id: string;
  level: number;
  start: number;
  end: number;
  center: number;
  mass: number;
  strength: number;
  parent_id: string | null;
};

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

  const parentById = new Map<string, string | null>();
  for (const node of renderNodes) {
    if ((node.level ?? 1) < 2 || !node.members || node.members.length !== 2) continue;
    const parentLevel = node.level ?? 1;
    for (const memberId of node.members) {
      const child = nodeById.get(memberId);
      if (!child) continue;
      const childLevel = child.level ?? 1;
      if (childLevel >= parentLevel) continue;

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

      const currentLevel = currentParent.level ?? 1;
      if (parentLevel < currentLevel) {
        parentById.set(memberId, node.id);
      }
    }
  }

  const spans: SpanItem[] = renderNodes
    .filter((node) => {
      const level = node.level ?? 1;
      if (level >= 2) return Array.isArray(node.members) && node.members.length === 2;
      const hasEffect = typeof (node.effect_anchor_index ?? node.consequence_anchor_index) === "number";
      return level === 1 && hasEffect;
    })
    .map((node) => {
      const span = getSpan(node);
      const level = node.level ?? 1;
      const center = node.center_index ?? Math.round((span.start + span.end) / 2);
      const mass = node.mass ?? node.link_mass ?? node.mass_base ?? 0;
      const strength = node.strength_internal ?? node.strength_bridge ?? node.strength_ce ?? node.score ?? 0;
      return {
        id: node.id,
        level,
        start: span.start,
        end: span.end,
        center,
        mass,
        strength,
        parent_id: parentById.get(node.id) ?? null,
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
      lines.push(
        `${indent}- [L${span.level} m=${span.mass.toFixed(2)} s=${span.strength.toFixed(2)} span L${span.start}–L${span.end} center=L${span.center}]`,
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
