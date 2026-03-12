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
  const stars = useMemo(() => {
    const campaignStars = testStars.filter((star) => star.type === "campaign");
    if (engine.state.phase === "SKY_IDLE") {
      return campaignStars;
    }

    return [
      {
        id: "s1",
        theta: 0,
        phi: 0,
        layer: "mid" as const,
        type: "proto" as const,
      },
      ...campaignStars,
    ];
  }, [engine.state.phase]);

  const protoStarStates = useMemo(() => {
    const map = new Map<string, ProtoStarRendererState>();
    if (engine.state.phase === "SKY_IDLE") {
      return map;
    }

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
    <div className={styles.skyLayer}>
      <SkyViewport
        stars={stars}
        protoStarStates={protoStarStates}
        onStarClick={(starId) => {
          if (starId !== "s1") {
            return;
          }

          if (engine.state.phase === "PROTO_STAR_FORMING") {
            engine.dispatch({
              type: "PROTO_STAR_CLICKED",
              at: Date.now(),
            });
          }
        }}
      />
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
