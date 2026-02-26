export type TranscriptLine = {
  lineIndex: number;
  speaker?: string;
  text: string;
};

export type Segment = {
  segmentId: string;
  startLine: number;
  endLine: number;
  lines: TranscriptLine[];
};

export type CarrySummary = {
  segmentId: string;
  summary: string;
};

export type CarryConfig = {
  maxCarryChars: number;
  maxCarrySegments: number;
};

export type CarryBlock = {
  text: string;
  usedChars: number;
  summaries: CarrySummary[];
};

export type FinalStyle = "detailed" | "balanced" | "concise";

export type SegmentPromptInput = {
  priorContext: string;
  segmentHeader: string;
  transcriptChunk: string;
};

export type PromptBundle = {
  systemPrompt: string;
  userPrompt: string;
};

export type SegmentCallLog = {
  segmentId: string;
  startLine: number;
  endLine: number;
  linesTotal: number;
  linesSent: number;
  contextCharsUsed: number;
  reqCharsEstimate: number;
  respChars: number;
  durationMs: number;
};

export type MegaMeecapMeta = {
  session: string;
  campaign: string;
  generated_at: string;
  model: string;
  segment_count: number;
  segment_size: number;
  total_input_lines: number;
  total_output_chars: number;
  final_style: FinalStyle | null;
  timing: {
    segment_calls_ms: number[];
    final_pass_ms: number;
  };
};

export type LlmCallInput = {
  systemPrompt: string;
  userPrompt: string;
  model: string;
};

export type LlmCall = (input: LlmCallInput) => Promise<string>;

export type OrchestrateInput = {
  sessionLabel: string;
  campaign: string;
  segmentSize: number;
  maxLlmLines: number;
  carryConfig: CarryConfig;
  style: FinalStyle;
  noFinalPass: boolean;
  model: string;
  lines: TranscriptLine[];
};

export type OrchestrateOutput = {
  baselineMarkdown: string;
  finalMarkdown: string | null;
  segmentLogs: SegmentCallLog[];
  finalPassMs: number;
  meta: MegaMeecapMeta;
};
