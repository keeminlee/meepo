import { createHash } from "node:crypto";
import { getDbForCampaign } from "../db.js";
import { resolveCampaignSlug } from "../campaign/guildConfig.js";
import { getGuildMode } from "../sessions/sessionRuntime.js";
import { formatSpeakerLine, resolveSpeakerAttribution, type SpeakerKind } from "../ledger/speakerLabel.js";
import { cfg } from "../config/env.js";
import { appendMeepoActionLogEvent } from "../ledger/meepoActionLogging.js";
import {
  MINI_MEECAP_KIND,
  getLatestBlockByKind,
  getRawBlocks,
  getContextRow,
  parseRawLines,
  resolveContextKey,
} from "../ledger/meepoContextRepo.js";

export async function loadMeepoContextSnapshot(opts: {
  guildId: string;
  sessionId?: string | null;
  windowMs?: number;
  limit?: number;
  anchorLedgerId?: string | null;
}): Promise<{ context: string; hasVoice: boolean; speakerKinds: SpeakerKind[]; revisionId: number; tokenEstimate: number }> {
  const campaignSlug = resolveCampaignSlug({ guildId: opts.guildId });
  const db = getDbForCampaign(campaignSlug);
  const key = resolveContextKey(opts.sessionId ?? null);

  const row = getContextRow(db, {
    guildId: opts.guildId,
    scope: key.scope,
    sessionId: key.sessionId,
  });

  const emitSnapshotEvent = (result: {
    context: string;
    hasVoice: boolean;
    speakerKinds: SpeakerKind[];
    revisionId: number;
    tokenEstimate: number;
  }, data: {
    message_count: number;
    source_ranges: Array<{ start_ledger_id: string | null; end_ledger_id: string | null; count: number }>;
    context_cursor: string | null;
    context_version: number;
    watermark: number;
  }) => {
    appendMeepoActionLogEvent(db, {
      ts_ms: Date.now(),
      run_kind: "online",
      guild_id: opts.guildId,
      scope: key.scope,
      campaign_slug: campaignSlug,
      session_id: key.sessionId,
      anchor_ledger_id: opts.anchorLedgerId ?? null,
      event: "context-snapshot-built",
      data: {
        ...data,
        context_hash: createHash("sha256").update(result.context, "utf8").digest("hex"),
      },
    });
    return result;
  };

  if (!row) {
    return emitSnapshotEvent(
      { context: "", hasVoice: false, speakerKinds: [], revisionId: 0, tokenEstimate: 0 },
      {
        message_count: 0,
        source_ranges: [],
        context_cursor: null,
        context_version: 0,
        watermark: 0,
      }
    );
  }

  const preferMini = cfg.features.contextMiniFirst && key.scope === "canon";
  if (preferMini) {
    const miniBlock = getLatestBlockByKind(db, {
      guildId: opts.guildId,
      scope: key.scope,
      sessionId: key.sessionId,
      kind: MINI_MEECAP_KIND,
    });
    if (miniBlock && miniBlock.content.trim().length > 0) {
      return emitSnapshotEvent(
        {
          context: miniBlock.content,
          hasVoice: false,
          speakerKinds: [],
          revisionId: row.revision_id,
          tokenEstimate: row.token_estimate,
        },
        {
          message_count: 1,
          source_ranges: [
            {
              start_ledger_id: null,
              end_ledger_id: null,
              count: 1,
            },
          ],
          context_cursor: row.ledger_cursor_id,
          context_version: row.revision_id,
          watermark: row.canon_line_cursor_watermark,
        }
      );
    }
  }

  const blocks = getRawBlocks(db, {
    guildId: opts.guildId,
    scope: key.scope,
    sessionId: key.sessionId,
  });

  const allLines = blocks.flatMap((block) => parseRawLines(block.content));
  if (allLines.length === 0) {
    return emitSnapshotEvent(
      {
        context: "",
        hasVoice: false,
        speakerKinds: [],
        revisionId: row.revision_id,
        tokenEstimate: row.token_estimate,
      },
      {
        message_count: 0,
        source_ranges: [],
        context_cursor: row.ledger_cursor_id,
        context_version: row.revision_id,
        watermark: row.canon_line_cursor_watermark,
      }
    );
  }

  const nowMs = Date.now();
  const windowMs = opts.windowMs ?? cfg.llm.voiceContextMs;
  const limit = opts.limit ?? 20;
  const cutoff = nowMs - windowMs;

  const inWindow = allLines.filter((line) => line.timestamp_ms >= cutoff);
  const selected = inWindow.slice(-limit);
  if (selected.length === 0) {
    return emitSnapshotEvent(
      {
        context: "",
        hasVoice: false,
        speakerKinds: [],
        revisionId: row.revision_id,
        tokenEstimate: row.token_estimate,
      },
      {
        message_count: 0,
        source_ranges: [],
        context_cursor: row.ledger_cursor_id,
        context_version: row.revision_id,
        watermark: row.canon_line_cursor_watermark,
      }
    );
  }

  const hasVoice = selected.some((line) => line.source === "voice");
  const canonMode = getGuildMode(opts.guildId) === "canon";

  const speakerKinds: SpeakerKind[] = [];
  const formattedLines: string[] = [];
  for (const line of selected) {
    const attribution = await resolveSpeakerAttribution({
      guildId: opts.guildId,
      authorId: line.author_id,
      discordDisplayName: line.author_name,
      canonMode,
    });
    speakerKinds.push(attribution.kind);
    formattedLines.push(formatSpeakerLine(attribution.label, line.content));
  }

  return emitSnapshotEvent(
    {
      context: formattedLines.join("\n"),
      hasVoice,
      speakerKinds,
      revisionId: row.revision_id,
      tokenEstimate: row.token_estimate,
    },
    {
      message_count: selected.length,
      source_ranges: [
        {
          start_ledger_id: selected[0]?.id ?? null,
          end_ledger_id: selected[selected.length - 1]?.id ?? null,
          count: selected.length,
        },
      ],
      context_cursor: row.ledger_cursor_id,
      context_version: row.revision_id,
      watermark: row.canon_line_cursor_watermark,
    }
  );
}
