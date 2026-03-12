import type { NarrativeEngineState, NarrativeStateEngine } from "@/lib/starstory/domain/narrative";

export function handleChronicleValidated(
  engine: NarrativeStateEngine,
  at: number = Date.now()
): NarrativeEngineState {
  return engine.dispatch({
    type: "CHRONICLE_VALIDATED",
    at,
  });
}

export function handleChronicleRejected(
  engine: NarrativeStateEngine,
  reason: string,
  at: number = Date.now()
): NarrativeEngineState {
  return engine.dispatch({
    type: "CHRONICLE_REJECTED",
    at,
    reason,
  });
}
