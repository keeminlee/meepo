"use client";

import { useMemo } from "react";
import type { Star, ProtoStarRendererState } from "@/lib/starstory/domain/sky/starData";
import { PARALLAX_SPEEDS } from "@/lib/starstory/domain/sky/starData";
import { ProtoStarRenderer } from "./ProtoStarRenderer";
import styles from "./sky.module.css";

const VIEWPORT_DEGREES = 120;

type StarLayerProps = {
  stars: Star[];
  cameraTheta: number;
  cameraPhi: number;
  protoStarStates: Map<string, ProtoStarRendererState>;
  onStarClick?: (id: string) => void;
};

function thetaToScreen(starTheta: number, cameraTheta: number, speed: number): number {
  const effectiveCamera = cameraTheta * speed;
  let diff = starTheta - effectiveCamera;
  diff = ((diff % 360) + 540) % 360 - 180;
  return 50 + (diff / VIEWPORT_DEGREES) * 100;
}

function phiToScreen(starPhi: number, cameraPhi: number, speed: number): number {
  const effectiveCamera = cameraPhi * speed;
  const diff = starPhi - effectiveCamera;
  return 50 - (diff / 60) * 100;
}

export function StarLayer({
  stars,
  cameraTheta,
  cameraPhi,
  protoStarStates,
  onStarClick,
}: StarLayerProps) {
  const positioned = useMemo(() => {
    return stars.map((star) => {
      const speed = PARALLAX_SPEEDS[star.layer];
      return {
        ...star,
        screenX: thetaToScreen(star.theta, cameraTheta, speed),
        screenY: phiToScreen(star.phi, cameraPhi, speed),
      };
    });
  }, [stars, cameraTheta, cameraPhi]);

  return (
    <div className={styles.starLayer}>
      {positioned.map((star) => {
        const protoState = protoStarStates.get(star.id);
        return (
          <div
            key={star.id}
            className={styles.starPosition}
            style={{
              left: `${star.screenX}%`,
              top: `${star.screenY}%`,
            }}
            onClick={() => onStarClick?.(star.id)}
          >
            {star.type === "proto" && protoState ? (
              <ProtoStarRenderer state={protoState} />
            ) : (
              <div className={styles.campaignStar} data-layer={star.layer} />
            )}
          </div>
        );
      })}
    </div>
  );
}
