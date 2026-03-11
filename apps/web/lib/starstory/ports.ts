import type { NarrativeEvent } from "@/lib/starstory/events";
import type { NarrativeEngineState } from "@/lib/starstory/types";

export interface StarStoryStatePort {
  loadSnapshot(): NarrativeEngineState | null;
  saveSnapshot(state: NarrativeEngineState): void;
  clearSnapshot(): void;
  loadAcceptedEventLog(): NarrativeEvent[];
  appendAcceptedEvent(event: NarrativeEvent): void;
  clearAcceptedEventLog(): void;
}