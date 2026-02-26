/**
 * Layer 0: Conversation Tail Context Builder
 *
 * Formats recent conversation history (session-scoped) for prompt injection.
 * Treats conversation as "quoted chat log" / "reported speech", not canonical truth.
 *
 * Output Format:
 * === DIRECT CONVERSATIONS (RECENT) ===
 * Snowflake: "Meepo, remember this."
 * Meepo: "I will keep your words close."
 * Jamison: "Never call me that again."
 *
 * Design:
 * - Session-scoped (tail resets on session end)
 * - Chronological order (oldest first)
 * - Limited to ~60 turns to fit token budget
 * - Empty string if no active session or no turns
 */

import { getConvoTail } from "../ledger/meepoConvo.js";

export interface ConvoTailContext {
  tailBlock: string;
}

/**
 * Build conversation tail context for a session.
 *
 * Returns formatted chat log of recent turns, or empty string if no session.
 *
 * @param session_id - Active session ID (null if no session)
 * @param limit - Max turns to retrieve (default: 60)
 * @returns Formatted tail block
 */
export function buildConvoTailContext(
  session_id: string | null,
  guildId: string,
  limit: number = 60
): ConvoTailContext {
  // No session = no tail
  if (!session_id) {
    return { tailBlock: "" };
  }

  const turns = getConvoTail(session_id, guildId, limit);

  // No turns = no tail
  if (turns.length === 0) {
    return { tailBlock: "" };
  }

  // Format turns as quoted chat log
  const lines = turns.map((turn) => {
    const speakerName = turn.speaker_name || turn.role;
    const content = turn.content_raw.replace(/"/g, '\\"'); // Escape quotes
    return `${speakerName}: "${content}"`;
  });

  const tailBlock = [
    "=== DIRECT CONVERSATIONS (RECENT) ===",
    ...lines,
    "", // Trailing newline
  ].join("\n");

  return { tailBlock };
}
