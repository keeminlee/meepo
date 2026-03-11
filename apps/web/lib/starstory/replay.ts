import type { NarrativeEvent } from "@/lib/starstory/events";
import { reduceNarrativeState } from "@/lib/starstory/reducer";
import { createInitialNarrativeState, type NarrativeEngineState } from "@/lib/starstory/types";

export function replayEvents(
  events: NarrativeEvent[],
  initialState: NarrativeEngineState = createInitialNarrativeState()
): NarrativeEngineState {
  let state = initialState;

  for (const event of events) {
    const result = reduceNarrativeState(state, event);
    if (!result.accepted) {
      continue;
    }
    state = result.state;
  }

  return state;
}