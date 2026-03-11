"use client";

import { useEffect, useRef, useState } from "react";
import {
  createInitialNarrativeState,
  createNarrativeEngine,
  LocalStorageStarStoryStatePort,
  projectProtoStarState,
  type NarrativeEvent,
  type NarrativeStateEngine,
} from "@/lib/starstory";

export function useNarrativeEngine() {
  const engineRef = useRef<NarrativeStateEngine | null>(null);
  const [state, setState] = useState(createInitialNarrativeState);

  useEffect(() => {
    const engine = createNarrativeEngine(new LocalStorageStarStoryStatePort());
    engineRef.current = engine;
    setState(engine.getSnapshot());

    return engine.subscribe((nextState) => {
      setState(nextState);
    });
  }, []);

  const engine = engineRef.current;

  return {
    state,
    protoStar: projectProtoStarState(state),
    dispatch(event: NarrativeEvent) {
      if (!engineRef.current) {
        return state;
      }
      return engineRef.current.dispatch(event);
    },
    resetAll(nowMs?: number) {
      if (!engineRef.current) {
        return state;
      }
      return engineRef.current.resetAll(nowMs);
    },
    clearSnapshotOnly() {
      if (!engineRef.current) {
        return state;
      }
      return engineRef.current.clearSnapshotOnly();
    },
    clearEventsOnly() {
      if (!engineRef.current) {
        return state;
      }
      return engineRef.current.clearEventsOnly();
    },
    hasEngine: Boolean(engine),
  };
}