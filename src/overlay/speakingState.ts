/**
 * Speaking state management for overlay
 * - Maintains global speaking state across all tokens
 * - Debounces "speaking=false" to prevent flicker on brief pauses
 * - Allows query of current state for WS client sync
 * - Tracks presence (who's in voice channel) for adaptive display
 */

const SPEAKING_OFF_DEBOUNCE_MS = 400;

const speakingState = new Map<string, boolean>();
const presenceState = new Map<string, boolean>();
const debounceTimers = new Map<string, NodeJS.Timeout>();
let onStateChange: ((id: string, speaking: boolean) => void) | null = null;
let onPresenceChange: ((id: string, present: boolean) => void) | null = null;

/**
 * Register callback for speaking state changes
 * Called with (id, speaking) when state actually changes
 */
export function onSpeakingStateChange(
  callback: (id: string, speaking: boolean) => void
) {
  onStateChange = callback;
}

/**
 * Register callback for presence state changes
 * Called with (id, present) when user joins/leaves voice
 */
export function onPresenceStateChange(
  callback: (id: string, present: boolean) => void
) {
  onPresenceChange = callback;
}

/**
 * Set speaking state for a token
 * - true: emit immediately
 * - false: emit after debounce (unless speaking resumes before timeout)
 */
export function setSpeaking(id: string, speaking: boolean) {
  const currentState = speakingState.get(id) ?? false;

  if (speaking) {
    // Clear any pending debounce
    const timer = debounceTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      debounceTimers.delete(id);
    }

    // Emit immediately if state actually changed
    if (!currentState) {
      speakingState.set(id, true);
      onStateChange?.(id, true);
    }
  } else {
    // Debounce the "false" event
    // If already false, do nothing
    if (!currentState) {
      return;
    }

    // Cancel existing debounce for this ID (in case of quick toggle)
    const existingTimer = debounceTimers.get(id);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Schedule the "false" emission
    const timer = setTimeout(() => {
      debounceTimers.delete(id);
      speakingState.set(id, false);
      onStateChange?.(id, false);
    }, SPEAKING_OFF_DEBOUNCE_MS);

    debounceTimers.set(id, timer);
  }
}

/**
 * Get current speaking state
 */
export function getSpeakingState(): Map<string, boolean> {
  return new Map(speakingState);
}

/**
 * Get current presence state
 */
export function getPresenceState(): Map<string, boolean> {
  return new Map(presenceState);
}

/**
 * Set presence state for a user (in/not in voice channel)
 */
export function setPresence(id: string, present: boolean) {
  const currentState = presenceState.get(id) ?? false;
  
  if (currentState !== present) {
    presenceState.set(id, present);
    onPresenceChange?.(id, present);
    
    // If user leaves, also mark them as no longer speaking
    if (!present) {
      setSpeaking(id, false);
    }
  }
}

/**
 * Force stop speaking (used for cleanup/testing)
 */
export function stopSpeakingAll() {
  debounceTimers.forEach(timer => clearTimeout(timer));
  debounceTimers.clear();
  speakingState.forEach((_, id) => {
    speakingState.set(id, false);
  });
}
