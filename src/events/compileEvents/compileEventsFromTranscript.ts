import type {
  CompileEventsInput,
  CompileEventsResult,
  CompiledEvent,
  CompileSegment,
  TranscriptEventLine,
} from "./types.js";

const VALID_EVENT_TYPES = new Set([
  "action",
  "dialogue",
  "discovery",
  "emotional",
  "conflict",
  "plan",
  "transition",
  "recap",
  "ooc_logistics",
]);

function normalizeEventRow(row: CompiledEvent, index: number): CompiledEvent {
  const fallbackStart = Number.isFinite(row.start_index) ? Math.floor(row.start_index) : 0;
  const fallbackEnd = Number.isFinite(row.end_index) ? Math.floor(row.end_index) : fallbackStart;

  const safeType =
    typeof row.event_type === "string" && VALID_EVENT_TYPES.has(row.event_type)
      ? row.event_type
      : "dialogue";

  return {
    start_index: Math.max(0, fallbackStart),
    end_index: Math.max(Math.max(0, fallbackStart), fallbackEnd),
    title:
      typeof row.title === "string" && row.title.trim().length > 0
        ? row.title.trim()
        : `Untitled event ${index + 1}`,
    event_type: safeType,
    is_ooc: typeof row.is_ooc === "boolean" ? row.is_ooc : false,
  };
}

function formatTranscript(lines: TranscriptEventLine[]): string {
  return lines
    .map((line) => {
      const iso = new Date(line.timestamp).toISOString();
      return `[${line.index}] [${iso}] ${line.author}: ${line.content}`;
    })
    .join("\n");
}

function normalizeEvents(events: CompiledEvent[]): CompiledEvent[] {
  const cleaned = events.map((event, index) => normalizeEventRow(event, index));
  return cleaned.sort((a, b) => {
    if (a.start_index !== b.start_index) return a.start_index - b.start_index;
    if (a.end_index !== b.end_index) return a.end_index - b.end_index;
    if (a.event_type !== b.event_type) return a.event_type.localeCompare(b.event_type);
    return a.title.localeCompare(b.title);
  });
}

function defaultSegment(lines: TranscriptEventLine[]): CompileSegment[] {
  if (lines.length === 0) return [];
  return [
    {
      id: "SEG_0001",
      startLineIndex: lines[0].index,
      endLineIndex: lines[lines.length - 1].index,
    },
  ];
}

export async function compileEventsFromTranscript(input: CompileEventsInput): Promise<CompileEventsResult> {
  const lines = [...input.lines].sort((a, b) => a.index - b.index);
  const segments = (input.segments && input.segments.length > 0 ? [...input.segments] : defaultSegment(lines)).sort(
    (a, b) => a.startLineIndex - b.startLineIndex,
  );

  const events: CompiledEvent[] = [];

  for (const segment of segments) {
    const fullSegmentLines = lines.filter(
      (line) => line.index >= segment.startLineIndex && line.index <= segment.endLineIndex,
    );

    if (fullSegmentLines.length === 0) {
      continue;
    }

    const hasPrebuiltExcerpt =
      typeof segment.excerptText === "string" &&
      Array.isArray(segment.excerptLineIndices) &&
      segment.excerptLineIndices.length > 0;

    const transcript = hasPrebuiltExcerpt
      ? segment.excerptText!
      : formatTranscript(fullSegmentLines);

    const effectiveStart = hasPrebuiltExcerpt
      ? Math.min(...segment.excerptLineIndices!)
      : fullSegmentLines[0].index;
    const effectiveEnd = hasPrebuiltExcerpt
      ? Math.max(...segment.excerptLineIndices!)
      : fullSegmentLines[fullSegmentLines.length - 1].index;

    if (!transcript.trim()) {
      continue;
    }

    const extracted = await input.llm.extractEvents({
      transcript,
      totalMessages: lines.length,
      rangeStartIndex: effectiveStart,
      rangeEndIndex: effectiveEnd,
    });

    events.push(...extracted);
  }

  return {
    events: normalizeEvents(events),
    metrics: {
      totalInputLines: lines.length,
      segmentsProcessed: segments.length,
      outputEventCount: events.length,
    },
  };
}
