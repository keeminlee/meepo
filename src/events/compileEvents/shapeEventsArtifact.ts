import type { CompiledEvent, TranscriptEventLine } from "./types.js";

export function shapeEventsArtifact(params: {
  sessionId: string;
  sessionLabel: string;
  events: CompiledEvent[];
  lines: TranscriptEventLine[];
}): { events: Array<Record<string, unknown>> } {
  const lineMap = new Map<number, TranscriptEventLine>();
  for (const line of params.lines) {
    lineMap.set(line.index, line);
  }

  const eventRows = params.events.map((event) => {
    const start = lineMap.get(event.start_index);
    const participants = new Set<string>();

    for (let i = event.start_index; i <= event.end_index; i++) {
      const line = lineMap.get(i);
      if (line) {
        participants.add(line.author);
      }
    }

    return {
      id: "<generated-at-upsert>",
      session_id: params.sessionId,
      event_type: event.event_type,
      participants: Array.from(participants).sort((a, b) => a.localeCompare(b)),
      description: event.title,
      confidence: 0.85,
      start_index: event.start_index,
      end_index: event.end_index,
      timestamp_ms: start?.timestamp ?? 0,
      created_at_ms: "<generated-at-upsert>",
      is_ooc: event.is_ooc ? 1 : 0,
      session_label: params.sessionLabel,
    };
  });

  return { events: eventRows };
}
