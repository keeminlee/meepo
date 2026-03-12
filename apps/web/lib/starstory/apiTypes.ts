import type { NarrativeEvent, NarrativeEngineState } from "@/lib/starstory/domain/narrative";

export interface GetStarStoryStateResponse {
  snapshot: NarrativeEngineState;
}

export interface PostStarStoryEventRequest {
  event: NarrativeEvent;
}