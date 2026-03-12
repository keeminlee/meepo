"use client";

import { useMemo, useState } from "react";
import { SkyViewport } from "@/components/openalpha/sky/SkyViewport";
import {
  testStars,
  narrativePhaseToRendererPhase,
  type ProtoStarRendererState,
  type ProtoStarRendererPhase,
} from "@/lib/starstory/domain/sky/starData";
import { useNarrativeEngine } from "@/components/openalpha/hooks/useNarrativeEngine";
import styles from "./openalpha.module.css";
import skyStyles from "./sky/sky.module.css";

export function SkyLayer() {
  const engine = useNarrativeEngine();
  const [phaseOverride, setPhaseOverride] = useState<ProtoStarRendererPhase | null>(null);

  const protoStarStates = useMemo(() => {
    const map = new Map<string, ProtoStarRendererState>();
    const effectivePhase = phaseOverride ?? narrativePhaseToRendererPhase(engine.state.phase);
    map.set("s1", {
      phase: effectivePhase,
      brightness: engine.protoStar.brightness,
      ringCount: engine.protoStar.ringCount,
      symbolDensity: engine.protoStar.symbolDensity,
      reactionLevel: engine.protoStar.reactionLevel,
      clickCount: engine.state.clickCount,
      transcriptLineCount: engine.protoStar.transcriptLineCount,
      campaignName: engine.protoStar.campaignName ?? "Proto-star",
    });
    return map;
  }, [engine.state.phase, engine.protoStar, phaseOverride]);

  const showDebug = process.env.NODE_ENV !== "production";

  return (
    <div className={styles.skyLayer} aria-hidden="true">
      <SkyViewport stars={testStars} protoStarStates={protoStarStates} />
      {showDebug ? (
        <div className={skyStyles.skyDebugControls}>
          {(["proto_progress_low", "proto_progress_mid", "supernova"] as const).map((p) => (
            <button
              key={p}
              className={skyStyles.skyDebugBtn}
              data-active={phaseOverride === p ? "true" : "false"}
              onClick={() => setPhaseOverride((prev) => (prev === p ? null : p))}
            >
              {p === "proto_progress_low" ? "Low" : p === "proto_progress_mid" ? "Mid" : "Nova"}
            </button>
          ))}
          {phaseOverride ? (
            <button className={skyStyles.skyDebugBtn} onClick={() => setPhaseOverride(null)}>
              Auto
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
