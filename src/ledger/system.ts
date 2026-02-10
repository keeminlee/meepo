import { randomUUID } from "node:crypto";
import { appendLedgerEntry } from "./ledger.js";

/**
 * System event logging (Phase 0)
 * 
 * System events have:
 * - source = 'system'
 * - narrative_weight = 'primary' (always part of narrative)
 * - tags = 'system,<event_type>'
 * - message_id = synthetic UUID (no Discord message)
 */

export function logSystemEvent(opts: {
  guildId: string;
  channelId: string;
  eventType: string;  // e.g., 'session_start', 'npc_wake', 'npc_transform'
  content: string;
  authorId?: string;
  authorName?: string;
}) {
  appendLedgerEntry({
    guild_id: opts.guildId,
    channel_id: opts.channelId,
    message_id: `system-${randomUUID()}`,
    author_id: opts.authorId ?? "system",
    author_name: opts.authorName ?? "System",
    timestamp_ms: Date.now(),
    content: opts.content,
    tags: `system,${opts.eventType}`,
    source: "system",
    narrative_weight: "primary",
  });
}
