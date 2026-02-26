/**
 * Layer 0: Conversation Memory (meepoConvo)
 *
 * Logs all direct Meepo ↔ player interactions for:
 * - Tail context (recent conversation within session)
 * - Candidate extraction (sticky statements for review)
 * - Approved internalization (into meepo_mind)
 *
 * Design:
 * - Session-scoped tail (resets on session end)
 * - Channel_id as metadata (for debugging/filtering)
 * - Offline approval workflow (no live trust)
 * - Unified memory store (approved → meepo_mind)
 */

import { getDbForCampaign } from "../db.js";
import { getDefaultCampaignSlug } from "../campaign/defaultCampaign.js";
import { resolveCampaignSlug } from "../campaign/guildConfig.js";
import { log } from "../utils/logger.js";

const convoLog = log.withScope("meepo-convo");

// ============================================================================
// Types
// ============================================================================

export interface ConvoTurn {
  id: number;
  session_id: string;
  channel_id: string;
  message_id: string | null;
  speaker_id: string | null;
  speaker_name: string | null;
  role: "player" | "meepo" | "system";
  content_raw: string;
  content_norm: string | null;
  ts_ms: number;
}

export interface ConvoCandidate {
  id: number;
  source_log_id: number;
  candidate_type: string;
  candidate_text: string;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  reviewed_ts_ms: number | null;
  review_notes: string | null;
  created_ts_ms: number;
}

export interface LogTurnOptions {
  guild_id: string;
  session_id: string;
  channel_id: string;
  message_id?: string | null;
  speaker_id?: string | null;
  speaker_name?: string | null;
  role: "player" | "meepo" | "system";
  content_raw: string;
  content_norm?: string | null;
  ts_ms?: number;
}

function getConvoDbForGuild(guildId: string) {
  const campaignSlug = resolveCampaignSlug({ guildId });
  return getDbForCampaign(campaignSlug);
}

function getConvoDbForCampaign(campaignSlug?: string) {
  return getDbForCampaign(campaignSlug ?? getDefaultCampaignSlug());
}

// ============================================================================
// Logging
// ============================================================================

/**
 * Log a single conversation turn.
 *
 * Idempotent: If message_id is provided and already exists, skips insert.
 * For voice or system messages without Discord message_id, pass null.
 *
 * @param opts - Turn metadata and content
 * @returns The log entry ID (new or existing)
 */
export function logConvoTurn(opts: LogTurnOptions): number {
  const db = getConvoDbForGuild(opts.guild_id);
  const ts_ms = opts.ts_ms ?? Date.now();

  try {
    // Check for existing entry if message_id is provided
    if (opts.message_id) {
      const existing = db
        .prepare("SELECT id FROM meepo_convo_log WHERE message_id = ?")
        .get(opts.message_id) as { id: number } | undefined;

      if (existing) {
        convoLog.debug(`Skipping duplicate turn for message_id=${opts.message_id}`);
        return existing.id;
      }
    }

    // Insert new turn
    const result = db
      .prepare(
        `INSERT INTO meepo_convo_log 
         (session_id, channel_id, message_id, speaker_id, speaker_name, role, content_raw, content_norm, ts_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        opts.session_id,
        opts.channel_id,
        opts.message_id ?? null,
        opts.speaker_id ?? null,
        opts.speaker_name ?? null,
        opts.role,
        opts.content_raw,
        opts.content_norm ?? null,
        ts_ms
      );

    const id = result.lastInsertRowid as number;
    convoLog.debug(`Logged ${opts.role} turn: ${id} (session=${opts.session_id.slice(0, 8)})`);
    return id;
  } catch (err: any) {
    convoLog.error(`Failed to log turn: ${err.message ?? err}`);
    throw err;
  }
}

// ============================================================================
// Retrieval
// ============================================================================

/**
 * Get recent conversation tail for a session.
 *
 * Returns turns ordered by timestamp (ascending = chronological).
 * Limit defaults to 60 to fit within token budget.
 *
 * @param session_id - Active session ID
 * @param limit - Max number of turns to retrieve (default: 60)
 * @returns Array of conversation turns (oldest first)
 */
export function getConvoTail(session_id: string, guildId: string, limit: number = 60): ConvoTurn[] {
  const db = getConvoDbForGuild(guildId);

  try {
    const turns = db
      .prepare(
        `SELECT * FROM meepo_convo_log 
         WHERE session_id = ? 
         ORDER BY ts_ms DESC 
         LIMIT ?`
      )
      .all(session_id, limit) as ConvoTurn[];

    // Reverse to get chronological order (oldest first)
    return turns.reverse();
  } catch (err: any) {
    convoLog.error(`Failed to get convo tail: ${err.message ?? err}`);
    throw err;
  }
}

/**
 * Get all conversation turns for a session (no limit).
 *
 * Used for post-session analysis and candidate extraction.
 *
 * @param session_id - Session ID
 * @returns Array of all turns (chronological order)
 */
export function getSessionConvo(session_id: string, campaignSlug?: string): ConvoTurn[] {
  const db = getConvoDbForCampaign(campaignSlug);

  try {
    return db
      .prepare(
        `SELECT * FROM meepo_convo_log 
         WHERE session_id = ? 
         ORDER BY ts_ms ASC`
      )
      .all(session_id) as ConvoTurn[];
  } catch (err: any) {
    convoLog.error(`Failed to get session convo: ${err.message ?? err}`);
    throw err;
  }
}

// ============================================================================
// Candidates
// ============================================================================

/**
 * Insert a candidate for review.
 *
 * Idempotent: Skips insert if (source_log_id, candidate_type) pair already exists.
 *
 * @param source_log_id - Reference to meepo_convo_log entry
 * @param candidate_type - Classification (e.g., "sticky_claim", "correction")
 * @param candidate_text - The extracted text to review
 * @param reason - Why this was flagged (optional)
 * @returns The candidate ID (new or existing)
 */
export function insertCandidate(
  source_log_id: number,
  candidate_type: string,
  candidate_text: string,
  reason?: string | null,
  campaignSlug?: string
): number {
  const db = getConvoDbForCampaign(campaignSlug);
  const created_ts_ms = Date.now();

  try {
    // Check for existing candidate
    const existing = db
      .prepare(
        "SELECT id FROM meepo_convo_candidate WHERE source_log_id = ? AND candidate_type = ?"
      )
      .get(source_log_id, candidate_type) as { id: number } | undefined;

    if (existing) {
      convoLog.debug(`Skipping duplicate candidate: log_id=${source_log_id}, type=${candidate_type}`);
      return existing.id;
    }

    // Insert new candidate
    const result = db
      .prepare(
        `INSERT INTO meepo_convo_candidate 
         (source_log_id, candidate_type, candidate_text, reason, status, created_ts_ms)
         VALUES (?, ?, ?, ?, 'pending', ?)`
      )
      .run(source_log_id, candidate_type, candidate_text, reason ?? null, created_ts_ms);

    const id = result.lastInsertRowid as number;
    convoLog.info(`Created candidate ${id}: type=${candidate_type}`);
    return id;
  } catch (err: any) {
    convoLog.error(`Failed to insert candidate: ${err.message ?? err}`);
    throw err;
  }
}

/**
 * List all pending candidates for review.
 *
 * @returns Array of pending candidates (oldest first)
 */
export function listPendingCandidates(campaignSlug?: string): ConvoCandidate[] {
  const db = getConvoDbForCampaign(campaignSlug);

  try {
    return db
      .prepare(
        `SELECT * FROM meepo_convo_candidate 
         WHERE status = 'pending' 
         ORDER BY created_ts_ms ASC`
      )
      .all() as ConvoCandidate[];
  } catch (err: any) {
    convoLog.error(`Failed to list pending candidates: ${err.message ?? err}`);
    throw err;
  }
}

/**
 * Get a single candidate with full context (including source turn).
 *
 * @param candidate_id - Candidate ID
 * @returns Candidate + source turn, or null if not found
 */
export function getCandidateWithContext(candidate_id: number): {
  candidate: ConvoCandidate;
  sourceTurn: ConvoTurn;
} | null {
  const db = getConvoDbForCampaign();

  try {
    const candidate = db
      .prepare("SELECT * FROM meepo_convo_candidate WHERE id = ?")
      .get(candidate_id) as ConvoCandidate | undefined;

    if (!candidate) return null;

    const sourceTurn = db
      .prepare("SELECT * FROM meepo_convo_log WHERE id = ?")
      .get(candidate.source_log_id) as ConvoTurn | undefined;

    if (!sourceTurn) {
      convoLog.error(`Orphaned candidate ${candidate_id}: source_log_id=${candidate.source_log_id} not found`);
      return null;
    }

    return { candidate, sourceTurn };
  } catch (err: any) {
    convoLog.error(`Failed to get candidate context: ${err.message ?? err}`);
    throw err;
  }
}

/**
 * Approve a candidate (mark as approved, does NOT insert into meepo_mind).
 *
 * Caller is responsible for inserting into meepo_mind separately.
 *
 * @param candidate_id - Candidate ID
 * @param review_notes - Optional notes from reviewer
 */
export function approveCandidate(candidate_id: number, review_notes?: string | null, campaignSlug?: string): void {
  const db = getConvoDbForCampaign(campaignSlug);
  const reviewed_ts_ms = Date.now();

  try {
    db.prepare(
      `UPDATE meepo_convo_candidate 
       SET status = 'approved', reviewed_ts_ms = ?, review_notes = ? 
       WHERE id = ?`
    ).run(reviewed_ts_ms, review_notes ?? null, candidate_id);

    convoLog.info(`Approved candidate ${candidate_id}`);
  } catch (err: any) {
    convoLog.error(`Failed to approve candidate: ${err.message ?? err}`);
    throw err;
  }
}

/**
 * Reject a candidate (mark as rejected).
 *
 * @param candidate_id - Candidate ID
 * @param review_notes - Optional reason for rejection
 */
export function rejectCandidate(candidate_id: number, review_notes?: string | null, campaignSlug?: string): void {
  const db = getConvoDbForCampaign(campaignSlug);
  const reviewed_ts_ms = Date.now();

  try {
    db.prepare(
      `UPDATE meepo_convo_candidate 
       SET status = 'rejected', reviewed_ts_ms = ?, review_notes = ? 
       WHERE id = ?`
    ).run(reviewed_ts_ms, review_notes ?? null, candidate_id);

    convoLog.info(`Rejected candidate ${candidate_id}`);
  } catch (err: any) {
    convoLog.error(`Failed to reject candidate: ${err.message ?? err}`);
    throw err;
  }
}
