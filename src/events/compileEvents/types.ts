export type EventType =
  | "action"
  | "dialogue"
  | "discovery"
  | "emotional"
  | "conflict"
  | "plan"
  | "transition"
  | "recap"
  | "ooc_logistics";

export interface TranscriptEventLine {
  index: number;
  author: string;
  content: string;
  timestamp: number;
}

export interface CompiledEvent {
  start_index: number;
  end_index: number;
  title: string;
  event_type: EventType;
  is_ooc?: boolean;
}

export interface CompileSegment {
  id: string;
  startLineIndex: number;
  endLineIndex: number;
  excerptText?: string;
  excerptLineIndices?: number[];
}

export interface CompileEventsLlm {
  extractEvents(params: {
    transcript: string;
    totalMessages: number;
    rangeStartIndex: number;
    rangeEndIndex: number;
  }): Promise<CompiledEvent[]>;
}

export interface CompileEventsInput {
  lines: TranscriptEventLine[];
  llm: CompileEventsLlm;
  segments?: CompileSegment[];
}

export interface CompileEventsMetrics {
  totalInputLines: number;
  segmentsProcessed: number;
  outputEventCount: number;
}

export interface CompileEventsResult {
  events: CompiledEvent[];
  metrics: CompileEventsMetrics;
}

export interface EventSpanValidation {
  isValid: boolean;
  issues: string[];
}
