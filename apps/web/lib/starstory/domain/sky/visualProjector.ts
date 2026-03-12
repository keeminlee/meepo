import type { ProtoStarState } from "../narrative";
import type { ProtoStarVisualState } from "./types";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function easeOut(value: number): number {
  return 1 - Math.pow(1 - value, 2);
}

function getGlowColor(phase: ProtoStarState["phase"]): string {
  switch (phase) {
    case "STAR_BORN":
      return "#f8f1b8";
    case "STAR_COLLAPSED":
      return "#7a4f7d";
    case "VALIDATION":
      return "#f2c27c";
    case "AWAKENED":
    case "CHRONICLE_RECORDING":
      return "#8bc6ff";
    case "AWAKENING_READY":
      return "#9a87ff";
    default:
      return "#d9e8ff";
  }
}

function getAnimationPhase(phase: ProtoStarState["phase"]): string {
  switch (phase) {
    case "PROTO_STAR_FORMING":
      return "forming";
    case "PROTO_STAR_ACTIVE":
      return "active";
    case "CHRONICLE_STARTED":
      return "chronicle";
    case "AWAKENING_READY":
      return "awakening-ready";
    case "AWAKENED":
      return "awakened";
    case "CHRONICLE_RECORDING":
      return "recording";
    case "VALIDATION":
      return "validation";
    case "STAR_BORN":
      return "permanent-pulse";
    case "STAR_COLLAPSED":
      return "collapsed";
    default:
      return "idle";
  }
}

export function projectVisualState(protoStar: ProtoStarState): ProtoStarVisualState {
  const glowIntensity = 0.2 + easeOut(clamp(protoStar.brightness, 0, 1)) * 0.8;
  const ringCount = Math.max(1, protoStar.ringCount || 1);
  const particleRate = clamp(protoStar.symbolDensity, 0.08, 1);
  const scale = 0.75 + clamp(protoStar.transcriptLineCount / 240, 0, 0.75);

  return {
    id: protoStar.id,
    phase: protoStar.phase,
    glowIntensity,
    glowColor: getGlowColor(protoStar.phase),
    orbitSpeedSeconds: Math.max(6, 18 - ringCount * 1.6),
    ringCount,
    particleRate,
    scale,
    animationPhase: getAnimationPhase(protoStar.phase),
    isPermanent: protoStar.isPermanent,
    label: protoStar.campaignName,
  };
}
