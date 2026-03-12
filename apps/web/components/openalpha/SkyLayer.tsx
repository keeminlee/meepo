"use client";

import { useMemo } from "react";
import { SkyRenderer } from "@/components/openalpha/sky/SkyRenderer";
import { positionStars } from "@/lib/starstory";
import { useNarrativeEngine } from "@/components/openalpha/hooks/useNarrativeEngine";
import styles from "./openalpha.module.css";

type Star = {
  top: string;
  left: string;
  sizePx: number;
  delayMs: number;
  pulseMs: number;
};

const STARS: Star[] = [
  { top: "10%", left: "14%", sizePx: 1, delayMs: 120, pulseMs: 4100 },
  { top: "17%", left: "71%", sizePx: 2, delayMs: 880, pulseMs: 5200 },
  { top: "22%", left: "49%", sizePx: 1, delayMs: 450, pulseMs: 4700 },
  { top: "28%", left: "83%", sizePx: 1, delayMs: 1380, pulseMs: 5500 },
  { top: "31%", left: "8%", sizePx: 2, delayMs: 1020, pulseMs: 4600 },
  { top: "36%", left: "61%", sizePx: 1, delayMs: 1760, pulseMs: 5800 },
  { top: "44%", left: "26%", sizePx: 1, delayMs: 640, pulseMs: 4900 },
  { top: "53%", left: "75%", sizePx: 2, delayMs: 920, pulseMs: 5400 },
  { top: "58%", left: "42%", sizePx: 1, delayMs: 1530, pulseMs: 5000 },
  { top: "66%", left: "13%", sizePx: 1, delayMs: 760, pulseMs: 4800 },
  { top: "69%", left: "88%", sizePx: 1, delayMs: 1120, pulseMs: 5300 },
  { top: "77%", left: "56%", sizePx: 2, delayMs: 220, pulseMs: 5600 },
  { top: "84%", left: "34%", sizePx: 1, delayMs: 1680, pulseMs: 5100 },
  { top: "90%", left: "67%", sizePx: 1, delayMs: 1340, pulseMs: 5700 },
];

export function SkyLayer() {
  const engine = useNarrativeEngine();
  const stars = useMemo(
    () =>
      positionStars([
        {
          protoStar: engine.protoStar,
          visual: engine.visualState,
        },
      ]),
    [engine.protoStar, engine.visualState]
  );

  return (
    <div className={styles.skyLayer} aria-hidden="true">
      <div className={styles.skyGrain} />
      {STARS.map((star) => (
        <span
          key={`${star.top}-${star.left}`}
          className={styles.star}
          style={{
            top: star.top,
            left: star.left,
            width: `${star.sizePx}px`,
            height: `${star.sizePx}px`,
            ["--delay-ms" as string]: `${star.delayMs}ms`,
            ["--pulse-ms" as string]: `${star.pulseMs}ms`,
          }}
        />
      ))}
      <SkyRenderer stars={stars} />
    </div>
  );
}
