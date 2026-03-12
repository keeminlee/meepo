"use client";

import type { Star } from "@/lib/starstory/domain/sky/starData";
import { PARALLAX_SPEEDS } from "@/lib/starstory/domain/sky/starData";
import styles from "./sky.module.css";

const VIEWPORT_DEGREES = 120;

type ConstellationLayerProps = {
  stars: Star[];
  cameraTheta: number;
  cameraPhi: number;
};

function thetaToPercent(starTheta: number, cameraTheta: number, speed: number): number {
  const effectiveCamera = cameraTheta * speed;
  let diff = starTheta - effectiveCamera;
  diff = ((diff % 360) + 540) % 360 - 180;
  return 50 + (diff / VIEWPORT_DEGREES) * 100;
}

function phiToPercent(starPhi: number, cameraPhi: number, speed: number): number {
  const effectiveCamera = cameraPhi * speed;
  const diff = starPhi - effectiveCamera;
  return 50 - (diff / 60) * 100;
}

export function ConstellationLayer({ stars, cameraTheta, cameraPhi }: ConstellationLayerProps) {
  if (stars.length < 2) return null;

  const lines: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  for (let i = 0; i < stars.length - 1; i++) {
    const a = stars[i];
    const b = stars[i + 1];
    const sa = PARALLAX_SPEEDS[a.layer];
    const sb = PARALLAX_SPEEDS[b.layer];
    lines.push({
      x1: thetaToPercent(a.theta, cameraTheta, sa),
      y1: phiToPercent(a.phi, cameraPhi, sa),
      x2: thetaToPercent(b.theta, cameraTheta, sb),
      y2: phiToPercent(b.phi, cameraPhi, sb),
    });
  }

  return (
    <svg className={styles.constellationLayer} viewBox="0 0 100 100" preserveAspectRatio="none">
      {lines.map((l, i) => (
        <line
          key={i}
          x1={l.x1}
          y1={l.y1}
          x2={l.x2}
          y2={l.y2}
          stroke="rgba(180,200,255,0.12)"
          strokeWidth="0.15"
        />
      ))}
    </svg>
  );
}
