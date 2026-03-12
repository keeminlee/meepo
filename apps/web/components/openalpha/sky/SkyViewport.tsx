"use client";

import { useEffect, useRef, useState } from "react";
import { StarfieldCanvas } from "./StarfieldCanvas";
import { StarLayer } from "./StarLayer";
import { ConstellationLayer } from "./ConstellationLayer";
import type { Star, ProtoStarRendererState } from "@/lib/starstory/domain/sky/starData";
import styles from "./sky.module.css";

const PHI_MIN = -30;
const PHI_MAX = 30;
const SCROLL_SPEED = 1.8;
const DEAD_ZONE_LEFT = 0.15;
const DEAD_ZONE_RIGHT = 0.85;
const DEAD_ZONE_TOP = 0.15;
const DEAD_ZONE_BOTTOM = 0.85;

type SkyViewportProps = {
  stars: Star[];
  protoStarStates: Map<string, ProtoStarRendererState>;
  onStarClick?: (id: string) => void;
};

export function SkyViewport({ stars, protoStarStates, onStarClick }: SkyViewportProps) {
  const [camera, setCamera] = useState({ theta: 0, phi: 0 });
  const mouseRef = useRef({ x: 0.5, y: 0.5 });
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      mouseRef.current = {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height,
      };
    };
    el.addEventListener("mousemove", onMove);
    return () => el.removeEventListener("mousemove", onMove);
  }, []);

  useEffect(() => {
    let prev = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - prev) / 16.67, 3);
      prev = now;

      const { x, y } = mouseRef.current;
      let dTheta = 0;
      let dPhi = 0;

      if (x < DEAD_ZONE_LEFT) {
        dTheta = -SCROLL_SPEED * ((DEAD_ZONE_LEFT - x) / DEAD_ZONE_LEFT) * dt;
      } else if (x > DEAD_ZONE_RIGHT) {
        dTheta = SCROLL_SPEED * ((x - DEAD_ZONE_RIGHT) / (1 - DEAD_ZONE_RIGHT)) * dt;
      }

      if (y < DEAD_ZONE_TOP) {
        dPhi = SCROLL_SPEED * 0.5 * ((DEAD_ZONE_TOP - y) / DEAD_ZONE_TOP) * dt;
      } else if (y > DEAD_ZONE_BOTTOM) {
        dPhi = -SCROLL_SPEED * 0.5 * ((y - DEAD_ZONE_BOTTOM) / (1 - DEAD_ZONE_BOTTOM)) * dt;
      }

      if (dTheta !== 0 || dPhi !== 0) {
        setCamera((prev) => ({
          theta: prev.theta + dTheta,
          phi: Math.max(PHI_MIN, Math.min(PHI_MAX, prev.phi + dPhi)),
        }));
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <div ref={containerRef} className={styles.skyViewport}>
      <StarfieldCanvas cameraTheta={camera.theta} cameraPhi={camera.phi} />
      <StarLayer
        stars={stars}
        cameraTheta={camera.theta}
        cameraPhi={camera.phi}
        protoStarStates={protoStarStates}
        onStarClick={onStarClick}
      />
      <ConstellationLayer stars={stars} cameraTheta={camera.theta} cameraPhi={camera.phi} />
    </div>
  );
}
