import type { NarrativeEngineState, NarrativeStateEngine } from "@/lib/starstory/domain/narrative";

export function handleTranscriptUpdate(
  engine: NarrativeStateEngine,
  transcriptLineCount: number,
  at: number = Date.now()
): NarrativeEngineState {
  return engine.dispatch({
    type: "TRANSCRIPT_UPDATED",
    at,
    transcriptLineCount,
  });
}
