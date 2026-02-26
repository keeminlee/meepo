/**
 * Tier S/A: Record and retrieve Meepo interactions.
 * Persist when we reply; retrieve for prompt injection so Meepo references prior conversations.
 * Upgrade: quoted snippets (resolve from ledger), last-direct-convo lock, Tier A cap.
 */

import { getDbForCampaign } from "../db.js";
import { resolveCampaignSlug } from "../campaign/guildConfig.js";
import { randomUUID } from "node:crypto";
import { getLedgerContentByMessage } from "./ledger.js";
import { buildTranscript } from "./transcripts.js";

export type Tier = "S" | "A";
export type Trigger =
  | "wake_phrase"
  | "name_mention"
  | "mention"
  | "in_bound_channel"
  | "latched_followup"
  | "direct_question"
  | "direct_instruction";

const DIRECT_INSTRUCTION_PATTERN = /\b(remember|note|don't forget|keep in mind|write down|remind me)\b/i;

/** Refine trigger by content: direct_question (?) or direct_instruction (remember/note/…). */
export function classifyTrigger(content: string, base: Trigger): Trigger {
  const t = (content ?? "").trim();
  if (t.includes("?")) return "direct_question";
  if (DIRECT_INSTRUCTION_PATTERN.test(t)) return "direct_instruction";
  return base;
}

export type MeepoInteractionRow = {
  id: string;
  guild_id: string;
  session_id: string | null;
  persona_id: string;
  tier: Tier;
  trigger: string;
  speaker_id: string;
  start_line_index: number | null;
  end_line_index: number | null;
  created_at_ms: number;
  meta_json: string | null;
};

function getInteractionsDbForGuild(guildId: string) {
  const campaignSlug = resolveCampaignSlug({ guildId });
  return getDbForCampaign(campaignSlug);
}

export function recordMeepoInteraction(opts: {
  guildId: string;
  sessionId: string | null;
  personaId: string;
  tier: Tier;
  trigger: Trigger;
  speakerId: string;
  startLineIndex?: number | null;
  endLineIndex?: number | null;
  meta?: Record<string, unknown>;
}): void {
  // Normalize trigger for DB (latched_followup is valid)
  const trigger = opts.trigger as string;
  const db = getInteractionsDbForGuild(opts.guildId);
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO meepo_interactions (id, guild_id, session_id, persona_id, tier, trigger, speaker_id, start_line_index, end_line_index, created_at_ms, meta_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    opts.guildId,
    opts.sessionId ?? null,
    opts.personaId,
    opts.tier,
    trigger,
    opts.speakerId,
    opts.startLineIndex ?? null,
    opts.endLineIndex ?? null,
    now,
    opts.meta ? JSON.stringify(opts.meta) : null
  );
}

const MAX_SNIPPET_CHARS = 200; // ~50 tokens per line, 2 lines user + 1 Meepo

export function trimToSnippet(text: string, maxChars: number = MAX_SNIPPET_CHARS): string {
  const t = (text ?? "").trim();
  if (t.length <= maxChars) return t;
  const cut = t.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > maxChars / 2 ? cut.slice(0, lastSpace) : cut) + "…";
}

/**
 * Resolve trigger content from transcript by session + line range (voice path).
 * Returns trimmed snippet or empty string if session/lines missing or transcript fails.
 */
function getTriggerContentFromTranscript(
  sessionId: string | null,
  startLine: number | null,
  endLine: number | null,
  db?: any
): string {
  if (sessionId == null || startLine == null || endLine == null) return "";
  try {
    const transcript = buildTranscript(sessionId, true, db);
    const start = Math.max(0, Math.min(startLine, endLine));
    const end = Math.min(transcript.length - 1, Math.max(startLine, endLine));
    const parts: string[] = [];
    for (let i = start; i <= end && parts.length < 2; i++) {
      const entry = transcript[i];
      if (entry) parts.push(`${entry.author_name}: ${entry.content}`);
    }
    return trimToSnippet(parts.join(" "));
  } catch {
    return "";
  }
}

/**
 * Resolve interaction rows to quoted snippets.
 * If message IDs exist → ledger lookup. Else if session + line indices → transcript (voice).
 * Reply for voice can come from meta.voice_reply_content_snippet.
 */
export function getInteractionSnippets(
  rows: MeepoInteractionRow[],
  guildId: string
): Array<{
  tier: Tier;
  triggerContent: string;
  replyContent: string;
  resolution: "message_id" | "transcript" | "fallback";
  summary?: string;
}> {
  const out: Array<{
    tier: Tier;
    triggerContent: string;
    replyContent: string;
    resolution: "message_id" | "transcript" | "fallback";
    summary?: string;
  }> = [];
  const db = getInteractionsDbForGuild(guildId);
  for (const row of rows) {
    const meta = row.meta_json ? (JSON.parse(row.meta_json) as Record<string, string>) : null;
    const tChannel = meta?.trigger_channel_id;
    const tMsg = meta?.trigger_message_id;
    const rChannel = meta?.reply_channel_id ?? tChannel;
    const rMsg = meta?.reply_message_id;
    const voiceReplySnippet = meta?.voice_reply_content_snippet;
    let triggerContent = "";
    let replyContent = "";
    let resolution: "message_id" | "transcript" | "fallback" = "fallback";

    if (tChannel && tMsg) {
      const entry = getLedgerContentByMessage({ guildId, channelId: tChannel, messageId: tMsg });
      if (entry) {
        triggerContent = trimToSnippet(entry.content);
        resolution = "message_id";
      }
    }
    if (!triggerContent && row.session_id != null && row.start_line_index != null && row.end_line_index != null) {
      triggerContent = getTriggerContentFromTranscript(
        row.session_id,
        row.start_line_index,
        row.end_line_index,
        db
      );
      if (triggerContent) resolution = "transcript";
    }

    if (rChannel && rMsg) {
      const entry = getLedgerContentByMessage({ guildId, channelId: rChannel, messageId: rMsg });
      if (entry) replyContent = trimToSnippet(entry.content);
    }
    if (!replyContent && voiceReplySnippet && typeof voiceReplySnippet === "string") {
      replyContent = trimToSnippet(voiceReplySnippet);
    }

    const summary = meta?.summary && typeof meta.summary === "string" ? meta.summary : undefined;
    out.push({ tier: row.tier, triggerContent, replyContent, resolution, summary });
  }
  return out;
}

/**
 * Find relevant Tier S/A interactions for prompt injection.
 * - Same guild + persona.
 * - Last-direct-convo lock: when speakerId set, always include most recent Tier S with that speaker first.
 * - Tier S up to limitS, Tier A capped at 2 (limitA), same-speaker preferred.
 */
export function findRelevantMeepoInteractions(opts: {
  guildId: string;
  sessionId?: string | null;
  personaId: string;
  speakerId?: string | null;
  limitS?: number;
  limitA?: number;
}): MeepoInteractionRow[] {
  const db = getInteractionsDbForGuild(opts.guildId);
  const limitS = opts.limitS ?? 3;
  const limitA = Math.min(opts.limitA ?? 2, 2); // Cap Tier A at 2

  const allRows = db
    .prepare(
      `SELECT id, guild_id, session_id, persona_id, tier, trigger, speaker_id, start_line_index, end_line_index, created_at_ms, meta_json
       FROM meepo_interactions
       WHERE guild_id = ? AND persona_id = ?
       ORDER BY created_at_ms DESC
       LIMIT ?`
    )
    .all(opts.guildId, opts.personaId, 50) as MeepoInteractionRow[];

  const tierSRaw: MeepoInteractionRow[] = [];
  const tierARaw: MeepoInteractionRow[] = [];
  for (const row of allRows) {
    if (row.tier === "S") tierSRaw.push(row);
    else if (row.tier === "A") tierARaw.push(row);
  }

  // Last-direct-convo lock: when speakerId set, ensure most recent Tier S with that speaker is included
  let lastDirectConvo: MeepoInteractionRow | null = null;
  if (opts.speakerId) {
    lastDirectConvo = tierSRaw.find((r) => r.speaker_id === opts.speakerId) ?? null;
  }

  const tierS: MeepoInteractionRow[] = [];
  const seen = new Set<string>();
  if (lastDirectConvo) {
    tierS.push(lastDirectConvo);
    seen.add(lastDirectConvo.id);
  }
  for (const r of tierSRaw) {
    if (tierS.length >= limitS) break;
    if (!seen.has(r.id)) {
      tierS.push(r);
      seen.add(r.id);
    }
  }

  // Tier A: cap at limitA, prefer same-speaker
  let tierA = tierARaw.slice(0, limitA);
  if (opts.speakerId) {
    tierA = [...tierARaw].sort((a, b) => {
      const aSame = a.speaker_id === opts.speakerId ? 1 : 0;
      const bSame = b.speaker_id === opts.speakerId ? 1 : 0;
      if (bSame !== aSame) return bSame - aSame;
      return b.created_at_ms - a.created_at_ms;
    });
    tierA = tierA.slice(0, limitA);
  }

  const result = [...tierS, ...tierA];
  result.sort((a, b) => b.created_at_ms - a.created_at_ms);
  return result;
}

/**
 * Format Tier S/A interactions as quoted snippets for the prompt.
 * Tier S → "LAST TIME YOU SPOKE TO ME"; Tier A → "RECENT TIMES YOU MENTIONED ME" (light).
 */
export function formatMeepoInteractionsSection(guildId: string, rows: MeepoInteractionRow[]): string {
  if (rows.length === 0) return "";
  const snippets = getInteractionSnippets(rows, guildId);
  const tierS = snippets.filter((s) => s.tier === "S");
  const tierA = snippets.filter((s) => s.tier === "A");

  const parts: string[] = [];
  if (tierS.length > 0) {
    const block = tierS
      .map((s) => {
        const quote =
          s.triggerContent || s.replyContent
            ? [s.triggerContent && `They said: "${s.triggerContent}"`, s.replyContent && `You replied: "${s.replyContent}"`]
                .filter(Boolean)
                .join(" ")
            : "";
        const useSummaryOnly = s.summary && quote.length > 120;
        if (useSummaryOnly && s.summary) return s.summary;
        if (s.summary) return `${s.summary} ${quote}`.trim();
        return quote || "(prior exchange; no transcript snippet)";
      })
      .join("\n");
    parts.push("LAST TIME YOU SPOKE TO ME:\n" + block);
  }
  if (tierA.length > 0) {
    const block = tierA
      .map((s) => {
        const user = s.triggerContent ? `They said: "${s.triggerContent}"` : "";
        return user || "(mentioned you; no transcript snippet)";
      })
      .join("\n");
    parts.push("RECENT TIMES YOU MENTIONED ME:\n" + block);
  }
  if (parts.length === 0) return "";
  return "\n" + parts.join("\n\n") + "\n";
}
