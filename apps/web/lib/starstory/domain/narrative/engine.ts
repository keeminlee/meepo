import type { NarrativeEvent } from "./events";
import type { StarStoryStatePort } from "./ports";
import { reduceNarrativeState } from "./reducer";
import { replayEvents } from "./replay";
import { createInitialNarrativeState, type NarrativeEngineState } from "./types";

type NarrativeStateListener = (state: NarrativeEngineState) => void;

export interface NarrativeStateEngine {
  getSnapshot(): NarrativeEngineState;
  dispatch(event: NarrativeEvent): NarrativeEngineState;
  subscribe(listener: NarrativeStateListener): () => void;
  resetAll(nowMs?: number): NarrativeEngineState;
  clearSnapshotOnly(): NarrativeEngineState;
  clearEventsOnly(): NarrativeEngineState;
}

function notify(listeners: Set<NarrativeStateListener>, state: NarrativeEngineState): void {
  for (const listener of listeners) {
    listener(state);
  }
}

export function createNarrativeEngine(port: StarStoryStatePort): NarrativeStateEngine {
  const listeners = new Set<NarrativeStateListener>();
  const storedSnapshot = port.loadSnapshot();
  const storedEvents = port.loadAcceptedEventLog();

  let currentState = storedSnapshot ?? replayEvents(storedEvents, createInitialNarrativeState());

  if (!storedSnapshot) {
    port.saveSnapshot(currentState);
  }

  return {
    getSnapshot() {
      return currentState;
    },

    dispatch(event) {
      const result = reduceNarrativeState(currentState, event);
      if (!result.accepted) {
        return currentState;
      }
      currentState = result.state;
      port.appendAcceptedEvent(event);
      port.saveSnapshot(currentState);
      notify(listeners, currentState);
      return currentState;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    resetAll(nowMs = Date.now()) {
      currentState = createInitialNarrativeState(nowMs);
      port.clearAcceptedEventLog();
      port.saveSnapshot(currentState);
      notify(listeners, currentState);
      return currentState;
    },

    clearSnapshotOnly() {
      port.clearSnapshot();
      currentState = replayEvents(port.loadAcceptedEventLog(), createInitialNarrativeState());
      port.saveSnapshot(currentState);
      notify(listeners, currentState);
      return currentState;
    },

    clearEventsOnly() {
      port.clearAcceptedEventLog();
      port.saveSnapshot(currentState);
      notify(listeners, currentState);
      return currentState;
    },
  };
}
