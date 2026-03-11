import type { NarrativeEvent } from "@/lib/starstory/events";
import type { StarStoryStatePort } from "@/lib/starstory/ports";
import type { NarrativeEngineState } from "@/lib/starstory/types";

export class MemoryStarStoryPort implements StarStoryStatePort {
  snapshot: NarrativeEngineState | null;
  events: NarrativeEvent[];

  constructor(args?: { snapshot?: NarrativeEngineState | null; events?: NarrativeEvent[] }) {
    this.snapshot = args?.snapshot ?? null;
    this.events = args?.events ? [...args.events] : [];
  }

  loadSnapshot(): NarrativeEngineState | null {
    return this.snapshot;
  }

  saveSnapshot(state: NarrativeEngineState): void {
    this.snapshot = state;
  }

  clearSnapshot(): void {
    this.snapshot = null;
  }

  loadAcceptedEventLog(): NarrativeEvent[] {
    return [...this.events];
  }

  appendAcceptedEvent(event: NarrativeEvent): void {
    this.events.push(event);
  }

  clearAcceptedEventLog(): void {
    this.events = [];
  }
}

export function buildHappyPathEvents(): NarrativeEvent[] {
  return [
    { type: "PROTO_STAR_SPAWNED", at: 1, starId: "star-1" },
    { type: "PROTO_STAR_CLICKED", at: 2 },
    { type: "PROTO_STAR_CLICKED", at: 3 },
    { type: "PROTO_STAR_CLICKED", at: 4 },
    { type: "PROTO_STAR_CLICKED", at: 5 },
    { type: "PROTO_STAR_CLICKED", at: 6 },
    { type: "CHRONICLE_STARTED", at: 7, campaignName: "Open Alpha" },
    { type: "DISCORD_INSTALL_COMPLETED", at: 8, guildId: "guild-1" },
    { type: "AWAKENING_COMPLETED", at: 9 },
    { type: "TRANSCRIPT_UPDATED", at: 10, transcriptLineCount: 150 },
    { type: "VALIDATION_STARTED", at: 11 },
    { type: "CHRONICLE_VALIDATED", at: 12 },
  ];
}