export type AmbientPreferences = {
  ambientMotionEnabled: boolean;
  showMeepo: boolean;
};

export const AMBIENT_PREFERENCES_STORAGE_KEY = "meepo.web.preferences";

export const DEFAULT_AMBIENT_PREFERENCES: AmbientPreferences = {
  ambientMotionEnabled: true,
  showMeepo: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function coerceBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function parseAmbientPreferences(input: unknown): AmbientPreferences {
  if (!isRecord(input)) {
    return DEFAULT_AMBIENT_PREFERENCES;
  }

  return {
    ambientMotionEnabled: coerceBoolean(
      input.ambientMotionEnabled,
      DEFAULT_AMBIENT_PREFERENCES.ambientMotionEnabled
    ),
    showMeepo: coerceBoolean(input.showMeepo, DEFAULT_AMBIENT_PREFERENCES.showMeepo),
  };
}

export function readAmbientPreferences(storage: Pick<Storage, "getItem">): AmbientPreferences {
  try {
    const raw = storage.getItem(AMBIENT_PREFERENCES_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_AMBIENT_PREFERENCES;
    }

    const parsed = JSON.parse(raw) as unknown;
    return parseAmbientPreferences(parsed);
  } catch {
    return DEFAULT_AMBIENT_PREFERENCES;
  }
}

export function writeAmbientPreferences(
  storage: Pick<Storage, "setItem">,
  preferences: AmbientPreferences
): void {
  try {
    storage.setItem(AMBIENT_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Ignore write failures in private mode/quota pressure; in-memory state stays active.
  }
}
