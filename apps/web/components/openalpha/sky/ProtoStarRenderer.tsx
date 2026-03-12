"use client";

import type { ProtoStarRendererState } from "@/lib/starstory/domain/sky/starData";
import styles from "./sky.module.css";

type ProtoStarRendererProps = {
  state: ProtoStarRendererState;
};

type ProtoStarVisualTuning = {
  scale: number;
  bloomScale: number;
  bloomOpacity: number;
  bloomInner: string;
  bloomOuter: string;
  imageFilter: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveAssetSrc(phase: ProtoStarRendererState["phase"]): string {
  switch (phase) {
    case "proto_progress_mid":
      return "/star-assets/proto_progress_mid.png";
    case "supernova":
      return "/star-assets/proto_supernova.png";
    default:
      return "/star-assets/proto_base.png";
  }
}

function resolveVisualTuning(state: ProtoStarRendererState): ProtoStarVisualTuning {
  const clickProgress = clamp(state.clickCount / 5, 0, 1);
  const transcriptProgress = Math.max(0, state.transcriptLineCount / 100);
  const brightnessBoost = clamp(state.brightness, 0, 1) * 0.08;

  switch (state.phase) {
    case "proto_progress_mid":
      {
        const scale = 1 + clickProgress * 0.12 + transcriptProgress * 0.18 + brightnessBoost;
        const bloomScale = 1.12 + clickProgress * 0.08 + transcriptProgress * 0.12;
        const bloomOpacity = 0.76 + clickProgress * 0.08 + transcriptProgress * 0.1;
        const warmth = clickProgress * 10 + transcriptProgress * 14;

        return {
          scale,
          bloomScale,
          bloomOpacity,
          bloomInner: `rgba(255, ${Math.round(240 - warmth)}, ${Math.round(174 - warmth * 0.35)}, 0.84)`,
          bloomOuter: `rgba(255, ${Math.round(214 - warmth * 0.7)}, ${Math.round(122 - warmth * 0.45)}, 0.28)`,
          imageFilter: `brightness(${(1.01 + clickProgress * 0.03 + transcriptProgress * 0.06).toFixed(3)}) saturate(${(1.04 + clickProgress * 0.05 + transcriptProgress * 0.06).toFixed(3)}) sepia(${(0.05 + transcriptProgress * 0.12).toFixed(3)}) hue-rotate(${(-6 - clickProgress * 6 - transcriptProgress * 8).toFixed(2)}deg)`,
        };
      }
    case "supernova":
      {
        const scale = 1.18 + transcriptProgress * 0.18 + brightnessBoost;
        const bloomScale = 1.3 + transcriptProgress * 0.14;
        const bloomOpacity = 0.92 + transcriptProgress * 0.08;

        return {
          scale,
          bloomScale,
          bloomOpacity,
          bloomInner: `rgba(255, ${Math.round(246 - transcriptProgress * 8)}, ${Math.round(214 - transcriptProgress * 10)}, 0.96)`,
          bloomOuter: `rgba(255, ${Math.round(199 - transcriptProgress * 12)}, ${Math.round(108 - transcriptProgress * 8)}, 0.34)`,
          imageFilter: `brightness(${(1.1 + transcriptProgress * 0.08).toFixed(3)}) saturate(${(1.14 + transcriptProgress * 0.08).toFixed(3)}) sepia(${(0.14 + transcriptProgress * 0.08).toFixed(3)}) hue-rotate(${(-14 - transcriptProgress * 6).toFixed(2)}deg)`,
        };
      }
    default:
      {
        const scale = 0.86 + clickProgress * 0.16 + brightnessBoost;
        const bloomScale = 0.98 + clickProgress * 0.16;
        const bloomOpacity = 0.62 + clickProgress * 0.14;
        const coolShift = clickProgress * 18;

        return {
          scale,
          bloomScale,
          bloomOpacity,
          bloomInner: `rgba(${Math.round(227 + clickProgress * 18)}, ${Math.round(236 + clickProgress * 8)}, 255, 0.72)`,
          bloomOuter: `rgba(${Math.round(182 + coolShift)}, ${Math.round(204 + clickProgress * 10)}, 255, 0.2)`,
          imageFilter: `brightness(${(0.92 + clickProgress * 0.08).toFixed(3)}) saturate(${(0.9 + clickProgress * 0.14).toFixed(3)}) sepia(${(0.02 + clickProgress * 0.05).toFixed(3)}) hue-rotate(${(8 - clickProgress * 16).toFixed(2)}deg)`,
        };
      }
  }
}

export function ProtoStarRenderer({ state }: ProtoStarRendererProps) {
  const src = resolveAssetSrc(state.phase);
  const visual = resolveVisualTuning(state);

  return (
    <div
      className={styles.protoStarAsset}
      data-phase={state.phase}
      style={{
        ["--proto-scale" as string]: `${visual.scale}`,
        ["--proto-bloom-scale" as string]: `${visual.bloomScale}`,
        ["--proto-bloom-opacity" as string]: `${visual.bloomOpacity}`,
        ["--proto-bloom-inner" as string]: visual.bloomInner,
        ["--proto-bloom-outer" as string]: visual.bloomOuter,
        ["--proto-image-filter" as string]: visual.imageFilter,
      }}
    >
      <div className={styles.starBloom} />
      <img
        src={src}
        alt={state.campaignName || "Proto-star"}
        className={styles.starCoreImg}
        draggable={false}
        onError={(e) => {
          const img = e.currentTarget;
          const fallback = "/star-assets/proto_base.png";
          if (!img.src.endsWith(fallback)) {
            img.src = fallback;
          }
        }}
      />
      {state.campaignName ? (
        <div className={styles.protoStarLabel}>{state.campaignName}</div>
      ) : null}
    </div>
  );
}
