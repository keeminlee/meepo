"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  createInitialNarrativeState,
  createNarrativeEngine,
  LocalStorageStarStoryStatePort,
  projectProtoStarState,
  type NarrativeEngineState,
  projectVisualState,
  type NarrativeEvent,
  type NarrativeStateEngine,
} from "@/lib/starstory";

let sharedEngine: NarrativeStateEngine | null = null;
const SERVER_SNAPSHOT = createInitialNarrativeState(0);

function subscribeOnServer(): () => void {
  return () => {};
}

function getServerSnapshot(): NarrativeEngineState {
  return SERVER_SNAPSHOT;
}

function getEngine(): NarrativeStateEngine {
  if (!sharedEngine) {
    sharedEngine = createNarrativeEngine(new LocalStorageStarStoryStatePort());
  }

  return sharedEngine;
}

export function useNarrativeEngine() {
  const engine = typeof window === "undefined" ? null : getEngine();
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  const state = useSyncExternalStore(
    engine ? engine.subscribe : subscribeOnServer,
    engine ? engine.getSnapshot : getServerSnapshot,
    getServerSnapshot
  );
  const protoStar = projectProtoStarState(state);
  const visualState = projectVisualState(protoStar);

  return {
    state,
    protoStar,
    visualState,
    dispatch(event: NarrativeEvent) {
      if (!engine) {
        return state;
      }
      return engine.dispatch(event);
    },
    resetAll(nowMs?: number) {
      if (!engine) {
        return state;
      }
      return engine.resetAll(nowMs);
    },
    clearSnapshotOnly() {
      if (!engine) {
        return state;
      }
      return engine.clearSnapshotOnly();
    },
    clearEventsOnly() {
      if (!engine) {
        return state;
      }
      return engine.clearEventsOnly();
    },
    hasEngine: isHydrated && Boolean(engine),
  };
}