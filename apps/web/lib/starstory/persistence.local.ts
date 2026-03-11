import type { NarrativeEvent } from "@/lib/starstory/events";
import type { StarStoryStatePort } from "@/lib/starstory/ports";
import type { NarrativeEngineState } from "@/lib/starstory/types";

export const STARSTORY_SNAPSHOT_STORAGE_KEY = "starstory.snapshot";
export const STARSTORY_EVENTS_STORAGE_KEY = "starstory.events";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getStorage(storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">):
  | Pick<Storage, "getItem" | "setItem" | "removeItem">
  | null {
  if (storage) {
    return storage;
  }
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage;
}

function parseSnapshot(input: unknown): NarrativeEngineState | null {
  if (!isRecord(input)) {
    return null;
  }

  const {
    id,
    phase,
    clickCount,
    reactionLevel,
    transcriptLineCount,
    campaignName,
    guildId,
    isInstalled,
    isAwakened,
    validationStatus,
    createdAtMs,
    updatedAtMs,
  } = input;

  if (
    typeof id !== "string" ||
    typeof phase !== "string" ||
    typeof clickCount !== "number" ||
    typeof reactionLevel !== "number" ||
    typeof transcriptLineCount !== "number" ||
    !(campaignName === null || typeof campaignName === "string") ||
    !(guildId === null || typeof guildId === "string") ||
    typeof isInstalled !== "boolean" ||
    typeof isAwakened !== "boolean" ||
    typeof validationStatus !== "string" ||
    typeof createdAtMs !== "number" ||
    typeof updatedAtMs !== "number"
  ) {
    return null;
  }

  return {
    id,
    phase,
    clickCount,
    reactionLevel,
    transcriptLineCount,
    campaignName,
    guildId,
    isInstalled,
    isAwakened,
    validationStatus,
    createdAtMs,
    updatedAtMs,
  } as NarrativeEngineState;
}

function parseEvents(input: unknown): NarrativeEvent[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.filter((entry): entry is NarrativeEvent => isRecord(entry) && typeof entry.type === "string") as NarrativeEvent[];
}

export class LocalStorageStarStoryStatePort implements StarStoryStatePort {
  private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;

  constructor(storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">) {
    this.storage = getStorage(storage);
  }

  loadSnapshot(): NarrativeEngineState | null {
    if (!this.storage) {
      return null;
    }
    try {
      const raw = this.storage.getItem(STARSTORY_SNAPSHOT_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      return parseSnapshot(JSON.parse(raw) as unknown);
    } catch {
      return null;
    }
  }

  saveSnapshot(state: NarrativeEngineState): void {
    if (!this.storage) {
      return;
    }
    try {
      this.storage.setItem(STARSTORY_SNAPSHOT_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage failures and keep in-memory state authoritative for the session.
    }
  }

  clearSnapshot(): void {
    if (!this.storage) {
      return;
    }
    try {
      this.storage.removeItem(STARSTORY_SNAPSHOT_STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }
  }

  loadAcceptedEventLog(): NarrativeEvent[] {
    if (!this.storage) {
      return [];
    }
    try {
      const raw = this.storage.getItem(STARSTORY_EVENTS_STORAGE_KEY);
      if (!raw) {
        return [];
      }
      return parseEvents(JSON.parse(raw) as unknown);
    } catch {
      return [];
    }
  }

  appendAcceptedEvent(event: NarrativeEvent): void {
    if (!this.storage) {
      return;
    }
    try {
      const events = this.loadAcceptedEventLog();
      events.push(event);
      this.storage.setItem(STARSTORY_EVENTS_STORAGE_KEY, JSON.stringify(events));
    } catch {
      // Ignore storage failures.
    }
  }

  clearAcceptedEventLog(): void {
    if (!this.storage) {
      return;
    }
    try {
      this.storage.removeItem(STARSTORY_EVENTS_STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }
  }
}