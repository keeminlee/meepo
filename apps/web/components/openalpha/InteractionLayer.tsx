"use client";

import { useMemo } from "react";
import { useNarrativeEngine } from "@/components/openalpha/hooks/useNarrativeEngine";
import styles from "./openalpha.module.css";

function buildStarId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `star-${Date.now()}`;
}

export function InteractionLayer() {
  const engine = useNarrativeEngine();
  const canInteract = useMemo(() => engine.state.phase === "SKY_IDLE", [engine.state.phase]);

  return (
    <div className={styles.interactionLayer} aria-label="Open Alpha interaction layer">
      {canInteract ? (
        <button
          type="button"
          className={styles.protoStarHitbox}
          aria-label="Summon proto-star"
          onClick={() => {
            engine.dispatch({
              type: "PROTO_STAR_SPAWNED",
              at: Date.now(),
              starId: buildStarId(),
            });
          }}
        />
      ) : null}
    </div>
  );
}
