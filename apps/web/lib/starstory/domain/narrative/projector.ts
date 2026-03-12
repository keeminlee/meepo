import type { NarrativeEngineState, ProtoStarState } from "./types";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function projectProtoStarState(engine: NarrativeEngineState): ProtoStarState {
  const brightness = clamp(engine.transcriptLineCount / 200, 0, 1);
  const ringCount = Math.max(0, Math.floor(engine.transcriptLineCount / 50));
  const symbolDensity = clamp(engine.transcriptLineCount / 300, 0, 1);

  return {
    id: engine.id,
    phase: engine.phase,
    brightness,
    ringCount,
    symbolDensity,
    reactionLevel: engine.reactionLevel,
    transcriptLineCount: engine.transcriptLineCount,
    campaignName: engine.campaignName,
    isPermanent: engine.phase === "STAR_BORN",
    canBeginChronicle: engine.phase === "PROTO_STAR_ACTIVE",
    canValidate: engine.phase === "AWAKENED" || engine.phase === "CHRONICLE_RECORDING",
  };
}
