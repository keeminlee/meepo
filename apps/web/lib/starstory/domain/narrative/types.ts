export type NarrativePhase =
  | "SKY_IDLE"
  | "PROTO_STAR_FORMING"
  | "PROTO_STAR_ACTIVE"
  | "CHRONICLE_STARTED"
  | "DISCORD_INSTALL_PENDING"
  | "AWAKENING_READY"
  | "AWAKENED"
  | "CHRONICLE_RECORDING"
  | "VALIDATION"
  | "STAR_BORN"
  | "STAR_COLLAPSED";

export type ValidationStatus = "idle" | "pending" | "passed" | "failed";

export interface NarrativeEngineState {
  id: string;
  phase: NarrativePhase;
  clickCount: number;
  reactionLevel: number;
  transcriptLineCount: number;
  campaignName: string | null;
  guildId: string | null;
  isInstalled: boolean;
  isAwakened: boolean;
  validationStatus: ValidationStatus;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface ProtoStarState {
  id: string;
  phase: NarrativePhase;
  brightness: number;
  ringCount: number;
  symbolDensity: number;
  reactionLevel: number;
  transcriptLineCount: number;
  campaignName: string | null;
  isPermanent: boolean;
  canBeginChronicle: boolean;
  canValidate: boolean;
}

export const MIN_TRANSCRIPT_THRESHOLD = 100;

export function createInitialNarrativeState(nowMs: number = Date.now()): NarrativeEngineState {
  return {
    id: "",
    phase: "SKY_IDLE",
    clickCount: 0,
    reactionLevel: 0,
    transcriptLineCount: 0,
    campaignName: null,
    guildId: null,
    isInstalled: false,
    isAwakened: false,
    validationStatus: "idle",
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };
}
