import type { NarrativePhase } from "../narrative";

export type StarLayer = "background" | "mid" | "foreground";
export type StarType = "proto" | "campaign";

export type Star = {
  id: string;
  theta: number;
  phi: number;
  layer: StarLayer;
  type: StarType;
};

export type ProtoStarRendererPhase =
  | "proto_progress_low"
  | "proto_progress_mid"
  | "supernova";

export type ProtoStarRendererState = {
  phase: ProtoStarRendererPhase;
  brightness: number;
  ringCount: number;
  symbolDensity: number;
  reactionLevel: number;
  clickCount: number;
  transcriptLineCount: number;
  campaignName: string;
};

export const PARALLAX_SPEEDS: Record<StarLayer, number> = {
  background: 0.3,
  mid: 0.6,
  foreground: 1.0,
};

export function narrativePhaseToRendererPhase(phase: NarrativePhase): ProtoStarRendererPhase {
  switch (phase) {
    case "VALIDATION":
    case "STAR_BORN":
      return "supernova";
    case "PROTO_STAR_ACTIVE":
    case "CHRONICLE_STARTED":
    case "DISCORD_INSTALL_PENDING":
    case "AWAKENING_READY":
    case "AWAKENED":
    case "CHRONICLE_RECORDING":
      return "proto_progress_mid";
    default:
      return "proto_progress_low";
  }
}

export const testStars: Star[] = [
  { id: "s1", theta: 100, phi: 0, layer: "mid", type: "proto" },
  { id: "s2", theta: 300, phi: 10, layer: "foreground", type: "campaign" },
  { id: "s3", theta: 600, phi: -5, layer: "background", type: "campaign" },
];
