import { randomUUID } from "node:crypto";
import {
  ensureContextRow,
  estimateTokenCount,
  getCursorAnchor,
  getLastRawBlock,
  getLedgerLinesAfterCursor,
  resolveContextKey,
  serializeRawLines,
  sumContextTokens,
  withImmediateTransaction,
} from "./meepoContextRepo.js";
import {
  enqueueMegameecapChunkIfNeeded,
  enqueueMiniCompactionIfNeeded,
  type MeepoContextActionExecutionOptions,
  processOneMeepoContextAction,
  resolveReceiptWatermark,
} from "./meepoContextActions.js";
import { cfg } from "../config/env.js";
import { appendMeepoActionLogEvent, flushDirtyMeepoActionMergedLogs, type MeepoActionRunKind } from "./meepoActionLogging.js";

function resolveCampaignSlugForGuild(db: any, guildId: string): string {
  try {
    const row = db
      .prepare(`SELECT campaign_slug FROM guild_config WHERE guild_id = ? LIMIT 1`)
      .get(guildId) as { campaign_slug: string } | undefined;
    const value = row?.campaign_slug?.trim();
    return value && value.length > 0 ? value : "default";
  } catch {
    return "default";
  }
}

export function runHeartbeatAfterLedgerWrite(
  db: any,
  args: {
    guildId: string;
    sessionId: string | null;
    ledgerEntryId: string;
    runKind?: MeepoActionRunKind;
  }
): void {
  let shouldProcessAction = false;
  const tickStartMs = Date.now();
  const runKind = args.runKind ?? "online";
  withImmediateTransaction(db, () => {
    const nowMs = Date.now();
    const key = resolveContextKey(args.sessionId);

    const contextRow = ensureContextRow(db, {
      guildId: args.guildId,
      scope: key.scope,
      sessionId: key.sessionId,
      nowMs,
    });

    const newLines = getLedgerLinesAfterCursor(db, {
      guildId: args.guildId,
      scope: key.scope,
      sessionId: key.sessionId,
      cursorId: contextRow.ledger_cursor_id,
    });

    const limitedLines = (() => {
      const anchor = getCursorAnchor(db, args.ledgerEntryId);
      if (!anchor) return newLines;
      return newLines.filter((line) => (
        line.timestamp_ms < anchor.timestamp_ms
        || (line.timestamp_ms === anchor.timestamp_ms && line.id <= anchor.id)
      ));
    })();

    if (limitedLines.length === 0) {
      return;
    }

    if (key.scope === "canon") {
      for (const line of limitedLines) {
        appendMeepoActionLogEvent(db, {
          ts_ms: nowMs,
          run_kind: runKind,
          guild_id: args.guildId,
          scope: key.scope,
          session_id: key.sessionId,
          event_type: "ledger_line_ingested",
          anchor_ledger_id: line.id,
          transcript_line: {
            ledger_id: line.id,
            author_name: line.author_name,
            content: line.content,
          },
        });
      }
    }

    const currentWatermark = key.scope === "canon"
      ? Math.max(contextRow.canon_line_cursor_watermark, resolveReceiptWatermark(db, {
          guildId: args.guildId,
          scope: key.scope,
          sessionId: key.sessionId,
        }))
      : contextRow.canon_line_cursor_watermark;
    const currentTotal = key.scope === "canon"
      ? Math.max(contextRow.canon_line_cursor_total, currentWatermark)
      : contextRow.canon_line_cursor_total;
    const nextTotal = key.scope === "canon"
      ? currentTotal + limitedLines.length
      : contextRow.canon_line_cursor_total;
    let enqueuedCount = 0;
    let dedupedCount = 0;

    const appendContent = serializeRawLines(limitedLines);
    if (appendContent.length > 0) {
      const lastBlock = getLastRawBlock(db, {
        guildId: args.guildId,
        scope: key.scope,
        sessionId: key.sessionId,
      });

      if (lastBlock) {
        const nextContent = lastBlock.content
          ? `${lastBlock.content}\n${appendContent}`
          : appendContent;
        const range = (() => {
          const start = (() => {
            try {
              const parsed = lastBlock.source_range_json ? JSON.parse(lastBlock.source_range_json) as { start_ledger_id?: string } : null;
              return parsed?.start_ledger_id ?? limitedLines[0]?.id;
            } catch {
              return limitedLines[0]?.id;
            }
          })();
          return {
            start_line: 1,
            end_line: nextTotal,
            start_ledger_id: start,
            end_ledger_id: limitedLines[limitedLines.length - 1]?.id ?? null,
            count: (nextContent.match(/\n/g)?.length ?? 0) + (nextContent.trim() ? 1 : 0),
          };
        })();

        db.prepare(
          `UPDATE meepo_context_blocks
           SET content = ?, token_estimate = ?, source_range_json = ?
           WHERE id = ?`
        ).run(
          nextContent,
          estimateTokenCount(nextContent),
          JSON.stringify(range),
          lastBlock.id
        );
      } else {
        db.prepare(
          `INSERT INTO meepo_context_blocks (
            id, guild_id, session_id, scope, kind, seq, content, token_estimate, source_range_json, superseded_at_ms
          ) VALUES (?, ?, ?, ?, 'raw_lines', 1, ?, ?, ?, NULL)`
        ).run(
          randomUUID(),
          args.guildId,
          key.sessionId,
          key.scope,
          appendContent,
          estimateTokenCount(appendContent),
          JSON.stringify({
            start_line: key.scope === "canon" ? currentTotal + 1 : 1,
            end_line: key.scope === "canon" ? nextTotal : limitedLines.length,
            start_ledger_id: limitedLines[0]?.id ?? null,
            end_ledger_id: limitedLines[limitedLines.length - 1]?.id ?? null,
            count: limitedLines.length,
          })
        );
      }
    }

    const latestCursorId = limitedLines[limitedLines.length - 1]!.id;
    const totalTokens = sumContextTokens(db, {
      guildId: args.guildId,
      scope: key.scope,
      sessionId: key.sessionId,
    });

    db.prepare(
      `UPDATE meepo_context
       SET ledger_cursor_id = ?,
           canon_line_cursor_total = ?,
           canon_line_cursor_watermark = ?,
           token_estimate = ?,
           revision_id = revision_id + 1,
           updated_at_ms = ?
       WHERE guild_id = ? AND scope = ? AND session_id = ?`
    ).run(
      latestCursorId,
      key.scope === "canon" ? nextTotal : contextRow.canon_line_cursor_total,
      key.scope === "canon" ? currentWatermark : contextRow.canon_line_cursor_watermark,
      totalTokens,
      nowMs,
      args.guildId,
      key.scope,
      key.sessionId
    );

    if (key.scope === "canon") {
      const miniResult = enqueueMiniCompactionIfNeeded(db, {
        guildId: args.guildId,
        scope: key.scope,
        sessionId: key.sessionId,
        cursorTotal: nextTotal,
        cursorWatermark: currentWatermark,
        nowMs,
        runKind,
      });
      if (miniResult.attempted) {
        if (miniResult.queued) enqueuedCount += 1;
        else dedupedCount += 1;
      }

      const megameecapResult = enqueueMegameecapChunkIfNeeded(db, {
        guildId: args.guildId,
        scope: key.scope,
        sessionId: key.sessionId,
        cursorTotal: nextTotal,
        cursorWatermark: currentWatermark,
        nowMs,
        runKind,
      });
      if (megameecapResult.attempted) {
        if (megameecapResult.queued) enqueuedCount += 1;
        else dedupedCount += 1;
      }

      shouldProcessAction = miniResult.queued || megameecapResult.queued;

      appendMeepoActionLogEvent(db, {
        ts_ms: nowMs,
        run_kind: runKind,
        guild_id: args.guildId,
        scope: key.scope,
        campaign_slug: resolveCampaignSlugForGuild(db, args.guildId),
        session_id: key.sessionId,
        anchor_ledger_id: latestCursorId,
        event: "heartbeat-tick",
        data: {
          cursor_before: contextRow.ledger_cursor_id,
          cursor_after: latestCursorId,
          watermark_before: contextRow.canon_line_cursor_watermark,
          watermark_after: currentWatermark,
          canon_delta: limitedLines.length,
          enqueued_count: enqueuedCount,
          deduped_count: dedupedCount,
          tick_ms: Date.now() - tickStartMs,
        },
      });
    }
  });

  if (shouldProcessAction && cfg.features.contextInlineActionsDev) {
    const options: MeepoContextActionExecutionOptions = {
      leaseTtlMs: cfg.meepoContextActions.leaseTtlMs,
      maxAttempts: cfg.meepoContextActions.maxAttempts,
      retryBaseMs: cfg.meepoContextActions.retryBaseMs,
      runKind,
    };
    void processOneMeepoContextAction(db, "heartbeat", options).then(() => {
      if (runKind === "online") {
        flushDirtyMeepoActionMergedLogs(db, { runKind });
      }
    });
    return;
  }

  if (runKind === "online") {
    flushDirtyMeepoActionMergedLogs(db, { runKind });
  }
}
