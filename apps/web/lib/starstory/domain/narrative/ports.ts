import type { NarrativeEvent } from "./events";
import type { NarrativeEngineState } from "./types";

export interface StarStoryStatePort {
  loadSnapshot(): NarrativeEngineState | null;
  saveSnapshot(state: NarrativeEngineState): void;
  clearSnapshot(): void;
  loadAcceptedEventLog(): NarrativeEvent[];
  appendAcceptedEvent(event: NarrativeEvent): void;
  clearAcceptedEventLog(): void;
}
