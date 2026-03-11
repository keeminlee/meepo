import type { NarrativeEvent } from "@/lib/starstory/events";
import type { NarrativeEngineState } from "@/lib/starstory/types";

export interface GetStarStoryStateResponse {
  snapshot: NarrativeEngineState;
}

export interface PostStarStoryEventRequest {
  event: NarrativeEvent;
}