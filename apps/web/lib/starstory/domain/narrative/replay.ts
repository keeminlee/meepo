import type { NarrativeEvent } from "./events";
import { reduceNarrativeState } from "./reducer";
import { createInitialNarrativeState, type NarrativeEngineState } from "./types";

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
