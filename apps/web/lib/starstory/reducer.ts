import type { NarrativeEvent } from "@/lib/starstory/events";
import {
  createInitialNarrativeState,
  MIN_TRANSCRIPT_THRESHOLD,
  type NarrativeEngineState,
} from "@/lib/starstory/types";

export interface ReduceNarrativeResult {
  state: NarrativeEngineState;
  accepted: boolean;
  reason?: string;
}

function reject(state: NarrativeEngineState, reason: string): ReduceNarrativeResult {
  return { state, accepted: false, reason };
}

function accept(state: NarrativeEngineState): ReduceNarrativeResult {
  return { state, accepted: true };
}

function withUpdatedState(
  current: NarrativeEngineState,
  at: number,
  patch: Partial<NarrativeEngineState>
): NarrativeEngineState {
  return {
    ...current,
    ...patch,
    updatedAtMs: at,
  };
}

function normalizeText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function reduceNarrativeState(
  current: NarrativeEngineState | null,
  event: NarrativeEvent
): ReduceNarrativeResult {
  const state = current ?? createInitialNarrativeState(event.at);

  switch (event.type) {
    case "SKY_ENTERED": {
      if (state.phase !== "SKY_IDLE") {
        return reject(state, "SKY_ENTERED is only accepted while idle.");
      }
      return accept(withUpdatedState(state, event.at, {}));
    }

    case "PROTO_STAR_SPAWNED": {
      if (state.phase !== "SKY_IDLE") {
        return reject(state, "PROTO_STAR_SPAWNED is only accepted from SKY_IDLE.");
      }
      const starId = normalizeText(event.starId);
      if (!starId) {
        return reject(state, "PROTO_STAR_SPAWNED requires a non-empty starId.");
      }
      return accept({
        ...state,
        id: starId,
        phase: "PROTO_STAR_FORMING",
        clickCount: 0,
        reactionLevel: 0,
        transcriptLineCount: 0,
        campaignName: null,
        guildId: null,
        isInstalled: false,
        isAwakened: false,
        validationStatus: "idle",
        createdAtMs: event.at,
        updatedAtMs: event.at,
      });
    }

    case "PROTO_STAR_CLICKED": {
      if (state.phase !== "PROTO_STAR_FORMING") {
        return reject(state, "PROTO_STAR_CLICKED is only accepted while the proto-star is forming.");
      }
      const clickCount = state.clickCount + 1;
      const nextPhase = clickCount >= 5 ? "PROTO_STAR_ACTIVE" : "PROTO_STAR_FORMING";
      return accept(
        withUpdatedState(state, event.at, {
          clickCount,
          reactionLevel: Math.min(clickCount, 4),
          phase: nextPhase,
        })
      );
    }

    case "CHRONICLE_STARTED": {
      if (state.phase !== "PROTO_STAR_ACTIVE") {
        return reject(state, "CHRONICLE_STARTED is only accepted from PROTO_STAR_ACTIVE.");
      }
      const campaignName = normalizeText(event.campaignName);
      if (!campaignName) {
        return reject(state, "CHRONICLE_STARTED requires a non-empty campaignName.");
      }
      return accept(
        withUpdatedState(state, event.at, {
          phase: "CHRONICLE_STARTED",
          campaignName,
        })
      );
    }

    case "DISCORD_INSTALL_COMPLETED": {
      if (state.phase !== "CHRONICLE_STARTED" && state.phase !== "DISCORD_INSTALL_PENDING") {
        return reject(
          state,
          "DISCORD_INSTALL_COMPLETED is only accepted from CHRONICLE_STARTED or DISCORD_INSTALL_PENDING."
        );
      }
      const guildId = normalizeText(event.guildId);
      if (!guildId) {
        return reject(state, "DISCORD_INSTALL_COMPLETED requires a non-empty guildId.");
      }
      return accept(
        withUpdatedState(state, event.at, {
          phase: "AWAKENING_READY",
          guildId,
          isInstalled: true,
        })
      );
    }

    case "AWAKENING_COMPLETED": {
      if (state.phase !== "AWAKENING_READY") {
        return reject(state, "AWAKENING_COMPLETED is only accepted from AWAKENING_READY.");
      }
      return accept(
        withUpdatedState(state, event.at, {
          phase: "AWAKENED",
          isAwakened: true,
        })
      );
    }

    case "TRANSCRIPT_UPDATED": {
      if (state.phase !== "AWAKENED" && state.phase !== "CHRONICLE_RECORDING") {
        return reject(
          state,
          "TRANSCRIPT_UPDATED is only accepted from AWAKENED or CHRONICLE_RECORDING."
        );
      }
      const transcriptLineCount = Math.max(0, Math.floor(event.transcriptLineCount));
      if (transcriptLineCount === state.transcriptLineCount && state.phase === "CHRONICLE_RECORDING") {
        return reject(state, "TRANSCRIPT_UPDATED must change transcriptLineCount while recording.");
      }
      return accept(
        withUpdatedState(state, event.at, {
          phase: "CHRONICLE_RECORDING",
          transcriptLineCount,
        })
      );
    }

    case "VALIDATION_STARTED": {
      if (state.phase !== "AWAKENED" && state.phase !== "CHRONICLE_RECORDING") {
        return reject(state, "VALIDATION_STARTED is only accepted from AWAKENED or CHRONICLE_RECORDING.");
      }
      return accept(
        withUpdatedState(state, event.at, {
          phase: "VALIDATION",
          validationStatus: "pending",
        })
      );
    }

    case "CHRONICLE_VALIDATED": {
      if (state.phase !== "VALIDATION") {
        return reject(state, "CHRONICLE_VALIDATED is only accepted from VALIDATION.");
      }
      if (state.transcriptLineCount < MIN_TRANSCRIPT_THRESHOLD) {
        return reject(state, "CHRONICLE_VALIDATED requires transcriptLineCount to meet the minimum threshold.");
      }
      return accept(
        withUpdatedState(state, event.at, {
          phase: "STAR_BORN",
          validationStatus: "passed",
        })
      );
    }

    case "CHRONICLE_REJECTED": {
      if (state.phase !== "VALIDATION") {
        return reject(state, "CHRONICLE_REJECTED is only accepted from VALIDATION.");
      }
      return accept(
        withUpdatedState(state, event.at, {
          phase: "STAR_COLLAPSED",
          validationStatus: "failed",
        })
      );
    }
  }
}