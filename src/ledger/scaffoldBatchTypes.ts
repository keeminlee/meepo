/**
 * scaffoldBatchTypes.ts
 *
 * Type contracts for batch LLM labeling of scaffold spans.
 *
 * Workflow:
 * 1. Load scaffold spans → build excerpts → batch (10 per batch)
 * 2. Send batch to LLM with immutable boundaries
 * 3. LLM returns only labels (title, type, is_ooc, participants)
 * 4. Join labels back by event_id (immutable join key)
 * 5. Output labeled events (in-memory, no DB yet)
 */

// ── Input: Scaffold span with excerpt ────────────────────────────────────────

export interface ScaffoldBatchItem {
  /** Immutable span identifier (e.g., "E0001"). Join key for LLM output. */
  event_id: string;

  /** 0-based inclusive start in transcript. */
  start_index: number;

  /** 0-based inclusive end in transcript. */
  end_index: number;

  /** What signal caused this boundary. */
  boundary_reason: string;

  /** Fraction of span spoken by DM (optional, for context). */
  dm_ratio?: number;

  /** Generated excerpt for LLM (deterministically built from transcript). */
  excerpt: string;
}

export interface EventScaffoldBatch {
  /** e.g., "BATCH_0001" */
  batch_id: string;

  /** Session UUID */
  session_id: string;

  /** Session label (e.g., "C2E20") for logging. */
  session_label?: string;

  /** Up to 10 scaffold items per batch. */
  items: ScaffoldBatchItem[];
}

// ── Output: LLM labels ──────────────────────────────────────────────────────

export type EventType =
  | "action"
  | "dialogue"
  | "discovery"
  | "emotional"
  | "conflict"
  | "plan"
  | "transition"
  | "recap"
  | "ooc_logistics"
  | "unknown";

export interface LabeledEvent {
  /** Immutable join key (matches ScaffoldBatchItem.event_id). */
  event_id: string;

  /** Brief event title (max 200 chars). */
  title: string;

  /** Event classification. */
  event_type: EventType;

  /** True if OOC/meta/logistics, false if in-character gameplay. */
  is_ooc: boolean;

  /** Optional importance rating. */
  importance?: 1 | 2 | 3 | 4 | 5;

  /** Optional participant list (raw names, not normalized yet). */
  participants?: string[];
}

// ── Joined output: Scaffold + Labels ────────────────────────────────────────

export interface LabeledScaffoldEvent extends ScaffoldBatchItem {
  /** LLM-assigned title. */
  title: string;

  /** LLM-assigned type. */
  event_type: EventType;

  /** LLM-assigned OOC flag. */
  is_ooc: boolean;

  /** Trace: which batch this event came from (for debugging). */
  label_batch_id: string;

  /** Optional importance (from LLM). */
  importance?: 1 | 2 | 3 | 4 | 5;

  /** Optional participants (from LLM). */
  participants?: string[];
}

// ── Utilities ───────────────────────────────────────────────────────────────

export const ALLOWED_EVENT_TYPES: EventType[] = [
  "action",
  "dialogue",
  "discovery",
  "emotional",
  "conflict",
  "plan",
  "transition",
  "recap",
  "ooc_logistics",
];

export function isValidEventType(value: string): value is EventType {
  return ALLOWED_EVENT_TYPES.includes(value as EventType);
}

export function normalizeEventType(value: string): EventType {
  // Simple alias mapping
  const aliases: Record<string, EventType> = {
    combat: "action",
    fight: "action",
    battle: "action",
    "npc dialogue": "dialogue",
    roleplay: "dialogue",
    exploration: "discovery",
    investigation: "discovery",
    emotional_moment: "emotional",
    tension: "emotional",
    disagreement: "conflict",
    argument: "conflict",
    negotiation: "plan",
    strategy: "plan",
    narration: "transition",
    interlude: "transition",
    summary: "recap",
    session_recap: "recap",
    ooc: "ooc_logistics",
    meta: "ooc_logistics",
    logistics: "ooc_logistics",
    tech: "ooc_logistics",
    rules: "ooc_logistics",
  };

  const lower = value.toLowerCase().trim();
  return aliases[lower] ?? (isValidEventType(lower) ? lower : "unknown");
}
