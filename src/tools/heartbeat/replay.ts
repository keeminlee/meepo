import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

export type ReplayMode = "enqueue" | "execute";
export type HeartbeatMode = "row" | "slice";

export type ReplayArgs = {
  campaign: string;
  sessionRef: string;
  fromLedgerId?: string;
  toLedgerId?: string;
  execute: boolean;
  enqueueOnly: boolean;
  dryRun: boolean;
  resetContext: boolean;
  resetReceipts: boolean;
  verbose: boolean;
  artifactDir?: string;
  yes: boolean;
  keepTemp: boolean;
  heartbeatMode: HeartbeatMode;
};

export type ReplaySummary = {
  ledgerProcessed: number;
  finalCursor: string | null;
  finalWatermark: number;
  queueDepth: number;
  artifactsWritten: string[];
  heartbeatMode: HeartbeatMode;
};

type WorkerTickOptions = {
  maxActionsPerTick: number;
  maxTotalRuntimeMs: number;
  leaseTtlMs: number;
  maxAttempts: number;
  retryBaseMs: number;
};

type RunReplayOnDbArgs = {
  db: any;
  guildId: string;
  sessionId: string;
  fromLedgerId?: string;
  toLedgerId?: string;
  execute: boolean;
  verbose?: boolean;
  heartbeatMode?: HeartbeatMode;
  artifactOutputDir?: string | null;
  workerTickOptions: WorkerTickOptions;
};

type SessionRow = {
  session_id: string;
  guild_id: string;
  kind: string;
  label: string | null;
};

function parseArgs(argv: string[]): ReplayArgs {
  let campaign = "";
  let sessionRef = "";
  let fromLedgerId: string | undefined;
  let toLedgerId: string | undefined;
  let execute = true;
  let enqueueOnly = false;
  let dryRun = false;
  let resetContext = true;
  let resetReceipts = true;
  let verbose = false;
  let artifactDir: string | undefined;
  let yes = false;
  let keepTemp = false;
  let heartbeatMode: HeartbeatMode = "row";

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--campaign" && argv[i + 1]) {
      campaign = argv[++i]!.trim();
    } else if (arg === "--session" && argv[i + 1]) {
      sessionRef = argv[++i]!.trim();
    } else if (arg === "--from-ledger-id" && argv[i + 1]) {
      fromLedgerId = argv[++i]!.trim();
    } else if (arg === "--to-ledger-id" && argv[i + 1]) {
      toLedgerId = argv[++i]!.trim();
    } else if (arg === "--execute") {
      execute = true;
    } else if (arg === "--enqueue-only") {
      enqueueOnly = true;
      execute = false;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--reset-context") {
      resetContext = true;
    } else if (arg === "--reset-receipts") {
      resetReceipts = true;
    } else if (arg === "--yes") {
      yes = true;
    } else if (arg === "--keep-temp") {
      keepTemp = true;
    } else if (arg === "--verbose") {
      verbose = true;
    } else if (arg === "--artifact-dir" && argv[i + 1]) {
      artifactDir = argv[++i]!.trim();
    } else if (arg === "--heartbeat-mode" && argv[i + 1]) {
      const mode = argv[++i]!.trim();
      if (mode === "row" || mode === "slice") heartbeatMode = mode;
    }
  }

  if (!campaign) {
    throw new Error("Missing required argument: --campaign <campaign_slug>");
  }
  if (!sessionRef) {
    throw new Error("Missing required argument: --session <session_id_or_label>");
  }

  return {
    campaign,
    sessionRef,
    fromLedgerId,
    toLedgerId,
    execute,
    enqueueOnly,
    dryRun,
    resetContext,
    resetReceipts,
    verbose,
    artifactDir,
    yes,
    keepTemp,
    heartbeatMode,
  };
}

function promptForConfirmation(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(`${message} (yes/no): `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "yes");
    });
  });
}

export function resolveSessionRow(db: any, sessionRef: string): SessionRow {
  const row = db
    .prepare(
      `SELECT session_id, guild_id, kind, label
       FROM sessions
       WHERE session_id = @sessionRef OR label = @sessionRef
       ORDER BY CASE WHEN session_id = @sessionRef THEN 0 ELSE 1 END ASC,
                created_at_ms DESC,
                session_id DESC
       LIMIT 1`
    )
    .get({ sessionRef }) as SessionRow | undefined;

  if (!row) {
    throw new Error(`Session not found: ${sessionRef}`);
  }
  if (row.kind !== "canon") {
    throw new Error(`Replay currently supports canon sessions only. session.kind=${row.kind}`);
  }
  return row;
}

function loadReplayLedgerIds(db: any, args: {
  guildId: string;
  sessionId: string;
  fromLedgerId?: string;
  toLedgerId?: string;
}): string[] {
  const where: string[] = ["guild_id = @guildId", "session_id = @sessionId"];
  const params: Record<string, unknown> = {
    guildId: args.guildId,
    sessionId: args.sessionId,
  };

  if (args.fromLedgerId) {
    where.push("id >= @fromLedgerId");
    params.fromLedgerId = args.fromLedgerId;
  }
  if (args.toLedgerId) {
    where.push("id <= @toLedgerId");
    params.toLedgerId = args.toLedgerId;
  }

  const rows = db
    .prepare(
      `SELECT id
       FROM ledger_entries
       WHERE ${where.join(" AND ")}
       ORDER BY timestamp_ms ASC, id ASC`
    )
    .all(params) as Array<{ id: string }>;

  return rows.map((row) => row.id);
}

function getContextState(db: any, guildId: string, sessionId: string): {
  cursorId: string | null;
  total: number;
  watermark: number;
} {
  const row = db
    .prepare(
      `SELECT ledger_cursor_id, canon_line_cursor_total, canon_line_cursor_watermark
       FROM meepo_context
       WHERE guild_id = ? AND scope = 'canon' AND session_id = ?
       LIMIT 1`
    )
    .get(guildId, sessionId) as {
      ledger_cursor_id: string | null;
      canon_line_cursor_total: number;
      canon_line_cursor_watermark: number;
    } | undefined;

  return {
    cursorId: row?.ledger_cursor_id ?? null,
    total: Number(row?.canon_line_cursor_total ?? 0),
    watermark: Number(row?.canon_line_cursor_watermark ?? 0),
  };
}

function resetReplayContext(db: any, args: {
  guildId: string;
  sessionId: string;
  resetReceipts: boolean;
  verbose?: boolean;
}): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `UPDATE meepo_context
       SET ledger_cursor_id = NULL,
           canon_line_cursor_total = 0,
           canon_line_cursor_watermark = 0,
           token_estimate = 0,
           revision_id = revision_id + 1,
           updated_at_ms = ?
       WHERE guild_id = ? AND scope = 'canon' AND session_id = ?`
    ).run(Date.now(), args.guildId, args.sessionId);

    db.prepare(
      `DELETE FROM meepo_context_blocks
       WHERE guild_id = ?
         AND scope = 'canon'
         AND session_id = ?
         AND kind IN ('raw_lines', 'mini_meecap')`
    ).run(args.guildId, args.sessionId);

    if (args.resetReceipts) {
      db.prepare(
        `DELETE FROM meepo_context_blocks
         WHERE guild_id = ?
           AND scope = 'canon'
           AND session_id = ?
           AND kind = 'receipt'`
      ).run(args.guildId, args.sessionId);
    }

    db.prepare(
      `DELETE FROM meepo_actions
       WHERE guild_id = ?
         AND scope = 'canon'
         AND session_id = ?
         AND status IN ('pending', 'processing')`
    ).run(args.guildId, args.sessionId);

    if (args.resetReceipts) {
      db.prepare(
        `DELETE FROM meepo_actions
         WHERE guild_id = ?
           AND scope = 'canon'
           AND session_id = ?
           AND action_type IN ('compact-mini-meecap', 'megameecap-update-chunk')
           AND status IN ('done', 'failed')`
      ).run(args.guildId, args.sessionId);
    }

    db.exec("COMMIT");
    if (args.verbose) {
      console.log(`[replay] reset-context complete (resetReceipts=${args.resetReceipts})`);
    }
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function hashFile(filePath: string): string {
  const data = fs.readFileSync(filePath);
  return createHash("sha256").update(data).digest("hex");
}

function snapshotArtifacts(outputDir: string | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!outputDir) return out;
  if (!fs.existsSync(outputDir)) return out;

  const names = fs.readdirSync(outputDir).sort((a, b) => a.localeCompare(b));
  for (const name of names) {
    const full = path.join(outputDir, name);
    if (!fs.statSync(full).isFile()) continue;
    out.set(full, hashFile(full));
  }
  return out;
}

function diffArtifactSnapshots(before: Map<string, string>, after: Map<string, string>): string[] {
  const out: string[] = [];
  for (const [filePath, hash] of after.entries()) {
    const prev = before.get(filePath);
    if (prev !== hash) {
      out.push(filePath);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function listQueueDepth(db: any, guildId: string, sessionId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM meepo_actions
       WHERE guild_id = ?
         AND scope = 'canon'
         AND session_id = ?
         AND status IN ('pending', 'processing')`
    )
    .get(guildId, sessionId) as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

function assertRangeDedupeInvariant(db: any, guildId: string, sessionId: string): void {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total, COUNT(DISTINCT dedupe_key) AS unique_count
       FROM meepo_actions
       WHERE guild_id = ?
         AND scope = 'canon'
         AND session_id = ?
         AND action_type = 'megameecap-update-chunk'`
    )
    .get(guildId, sessionId) as { total: number; unique_count: number } | undefined;

  const total = Number(row?.total ?? 0);
  const unique = Number(row?.unique_count ?? 0);
  if (total !== unique) {
    throw new Error(`Range dedupe invariant failed: total=${total} unique=${unique}`);
  }
}

export async function runReplayOnDb(args: RunReplayOnDbArgs): Promise<ReplaySummary> {
  const {
    db,
    guildId,
    sessionId,
    fromLedgerId,
    toLedgerId,
    execute,
    verbose,
    heartbeatMode = "row",
    artifactOutputDir,
    workerTickOptions,
  } = args;

  const { runHeartbeatAfterLedgerWrite } = await import("../../ledger/meepoContextHeartbeat.js");
  const { getMeepoContextQueueStatus, processMeepoContextActionsTick } = await import("../../ledger/meepoContextActions.js");
  const { appendMeepoActionLogEvent, flushDirtyMeepoActionMergedLogs } = await import("../../ledger/meepoActionLogging.js");

  const drainQueue = async (): Promise<void> => {
    let safetyTicks = 0;
    while (true) {
      const statusBefore = getMeepoContextQueueStatus(db);
      if (statusBefore.queuedCount <= 0 && statusBefore.leasedCount <= 0) {
        break;
      }
      const tick = await processMeepoContextActionsTick(db, "heartbeat-replay", {
        ...workerTickOptions,
        runKind: "offline_replay",
      });
      safetyTicks += 1;

      if (verbose) {
        console.log(
          `[replay] tick=${safetyTicks} processed=${tick.processed} succeeded=${tick.succeeded} failed=${tick.failed} timedOut=${tick.timedOut}`,
        );
      }

      if (tick.processed === 0 && !tick.timedOut) {
        break;
      }
      if (safetyTicks > 20_000) {
        throw new Error("Aborting replay: worker drain exceeded 20000 ticks");
      }
    }
  };

  const ledgerIds = loadReplayLedgerIds(db, {
    guildId,
    sessionId,
    fromLedgerId,
    toLedgerId,
  });
  const artifactBefore = snapshotArtifacts(artifactOutputDir);

  if (ledgerIds.length > 0) {
    appendMeepoActionLogEvent(db, {
      ts_ms: Date.now(),
      run_kind: "offline_replay",
      guild_id: guildId,
      scope: "canon",
      session_id: sessionId,
      event_type: "replay_start",
      anchor_ledger_id: ledgerIds[0]!,
      status: execute ? "execute" : "enqueue_only",
    });
  }

  let prev = getContextState(db, guildId, sessionId);

  if (heartbeatMode === "slice") {
    if (ledgerIds.length > 0) {
      runHeartbeatAfterLedgerWrite(db, {
        guildId,
        sessionId,
        ledgerEntryId: ledgerIds[ledgerIds.length - 1]!,
        runKind: "offline_replay",
      });
      const after = getContextState(db, guildId, sessionId);
      if (after.total < prev.total) {
        throw new Error(`Non-monotonic total detected: ${after.total} < ${prev.total}`);
      }
      if (after.watermark < prev.watermark) {
        throw new Error(`Non-monotonic watermark detected: ${after.watermark} < ${prev.watermark}`);
      }
      prev = after;
    }
  } else {
    for (const ledgerId of ledgerIds) {
      runHeartbeatAfterLedgerWrite(db, {
        guildId,
        sessionId,
        ledgerEntryId: ledgerId,
        runKind: "offline_replay",
      });

      if (execute) {
        const queueStatus = getMeepoContextQueueStatus(db);
        if (queueStatus.queuedCount > 0 || queueStatus.leasedCount > 0) {
          await drainQueue();
        }
      }

      const after = getContextState(db, guildId, sessionId);
      if (after.total < prev.total) {
        throw new Error(`Non-monotonic total detected: ${after.total} < ${prev.total} at ledger=${ledgerId}`);
      }
      if (after.watermark < prev.watermark) {
        throw new Error(`Non-monotonic watermark detected: ${after.watermark} < ${prev.watermark} at ledger=${ledgerId}`);
      }
      prev = after;
    }
  }

  if (execute) {
    await drainQueue();
  }

  assertRangeDedupeInvariant(db, guildId, sessionId);

  const finalState = getContextState(db, guildId, sessionId);
  if (finalState.total < prev.total) {
    throw new Error(`Final total regressed: ${finalState.total} < ${prev.total}`);
  }
  if (finalState.watermark < prev.watermark) {
    throw new Error(`Final watermark regressed: ${finalState.watermark} < ${prev.watermark}`);
  }

  const artifactAfter = snapshotArtifacts(artifactOutputDir);
  const artifactDiff = diffArtifactSnapshots(artifactBefore, artifactAfter);

  if (finalState.cursorId) {
    appendMeepoActionLogEvent(db, {
      ts_ms: Date.now(),
      run_kind: "offline_replay",
      guild_id: guildId,
      scope: "canon",
      session_id: sessionId,
      event_type: "replay_end",
      anchor_ledger_id: finalState.cursorId,
      status: execute ? "execute" : "enqueue_only",
    });
  }
  flushDirtyMeepoActionMergedLogs(db, { runKind: "offline_replay" });

  return {
    ledgerProcessed: ledgerIds.length,
    finalCursor: finalState.cursorId,
    finalWatermark: finalState.watermark,
    queueDepth: listQueueDepth(db, guildId, sessionId),
    artifactsWritten: artifactDiff,
    heartbeatMode,
  };
}

function printSummary(summary: ReplaySummary): void {
  console.log("=== HEARTBEAT REPLAY SUMMARY ===");
  console.log(`Ledger processed: ${summary.ledgerProcessed} entries`);
  console.log(`Final cursor: ${summary.finalCursor ?? "(null)"}`);
  console.log(`Final watermark: ${summary.finalWatermark}`);
  console.log(`Queued actions: ${summary.queueDepth}`);
  console.log(`Artifacts written: ${JSON.stringify(summary.artifactsWritten)}`);
  console.log("=== OK ===");
}

async function runCli(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.execute && !process.env.OPENAI_API_KEY?.trim()) {
    throw new Error("Replay execution requires OPENAI_API_KEY (fail-fast preflight)");
  }

  const { resolveCampaignDbPath, resolveSessionMegameecapPaths } = await import("../../dataPaths.js");
  const { cfg } = await import("../../config/env.js");
  const { clearMeepoActionLogArtifacts } = await import("../../ledger/meepoActionLogging.js");

  const sourceDbPath = path.resolve(resolveCampaignDbPath(args.campaign));
  if (!fs.existsSync(sourceDbPath)) {
    throw new Error(`Campaign DB not found: ${sourceDbPath}`);
  }

  const shouldResetContext = args.resetContext;
  const shouldResetReceipts = args.resetReceipts;
  const shouldExecute = args.execute;

  const baseDb = new Database(sourceDbPath);
  const session = resolveSessionRow(baseDb, args.sessionRef);

  const meecapPaths = resolveSessionMegameecapPaths({
    campaignSlug: args.campaign,
    sessionId: session.session_id,
    sessionLabel: session.label,
    finalStyle: "balanced",
  });
  const artifactDir = args.artifactDir
    ? path.resolve(args.artifactDir)
    : path.join(meecapPaths.outputDir, "offline_replay");

  if (!args.yes && shouldExecute) {
    const confirmed = await promptForConfirmation(
      "This will call LLMs and regenerate artifacts. Proceed?"
    );
    if (!confirmed) {
      throw new Error("Replay aborted by user");
    }
  }

  if (shouldResetContext) {
    console.log(`[replay] Resetting heartbeat state for session ${session.session_id} ...`);
  }
  if (shouldResetReceipts) {
    console.log("[replay] Ignoring/clearing receipts for regeneration ...");
  }
  if (shouldExecute) {
    console.log(`[replay] Writing artifacts to offline replay dir: ${artifactDir}`);
  }

  if (shouldExecute && fs.existsSync(artifactDir)) {
    const existingFiles = fs.readdirSync(artifactDir).filter((name) => name.endsWith(".md") || name.endsWith(".json"));
    if (existingFiles.length > 0) {
      console.warn(`[replay] warning: artifact dir already contains ${existingFiles.length} files: ${artifactDir}`);
    }
  }

  let db = baseDb;
  let tempRoot: string | null = null;
  const originalArtifactOverride = process.env.MEEPO_HEARTBEAT_REPLAY_ARTIFACT_DIR;

  try {
    if (args.dryRun) {
      tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meepo-heartbeat-replay-"));
      const tempDbPath = path.join(tempRoot, "campaign.sqlite");
      fs.copyFileSync(sourceDbPath, tempDbPath);
      db.close();
      db = new Database(tempDbPath);

      if (shouldExecute) {
        const dryArtifactDir = args.artifactDir
          ? path.resolve(args.artifactDir)
          : path.join(tempRoot, "artifacts", "meecaps", "offline_replay");
        fs.mkdirSync(dryArtifactDir, { recursive: true });
        process.env.MEEPO_HEARTBEAT_REPLAY_ARTIFACT_DIR = dryArtifactDir;
      }
    } else if (shouldExecute) {
      fs.mkdirSync(artifactDir, { recursive: true });
      process.env.MEEPO_HEARTBEAT_REPLAY_ARTIFACT_DIR = artifactDir;
    }

    if (shouldResetContext) {
      resetReplayContext(db, {
        guildId: session.guild_id,
        sessionId: session.session_id,
        resetReceipts: shouldResetReceipts,
        verbose: args.verbose,
      });

      clearMeepoActionLogArtifacts(db, {
        guildId: session.guild_id,
        sessionId: session.session_id,
        runKind: "offline_replay",
      });
    }

    const summary = await runReplayOnDb({
      db,
      guildId: session.guild_id,
      sessionId: session.session_id,
      fromLedgerId: args.fromLedgerId,
      toLedgerId: args.toLedgerId,
      execute: shouldExecute,
      verbose: args.verbose,
      heartbeatMode: args.heartbeatMode,
      artifactOutputDir: shouldExecute
        ? (process.env.MEEPO_HEARTBEAT_REPLAY_ARTIFACT_DIR?.trim() || artifactDir)
        : null,
      workerTickOptions: {
        maxActionsPerTick: cfg.meepoContextActions.maxActionsPerTick,
        maxTotalRuntimeMs: cfg.meepoContextActions.maxTotalRuntimeMs,
        leaseTtlMs: cfg.meepoContextActions.leaseTtlMs,
        maxAttempts: cfg.meepoContextActions.maxAttempts,
        retryBaseMs: cfg.meepoContextActions.retryBaseMs,
      },
    });

    printSummary(summary);
  } finally {
    db.close();
    if (originalArtifactOverride === undefined) {
      delete process.env.MEEPO_HEARTBEAT_REPLAY_ARTIFACT_DIR;
    } else {
      process.env.MEEPO_HEARTBEAT_REPLAY_ARTIFACT_DIR = originalArtifactOverride;
    }
    if (tempRoot && !args.keepTemp) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } else if (tempRoot && args.keepTemp) {
      console.log(`[replay] kept temp replay workspace: ${tempRoot}`);
    }
  }
}

const isMain = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMain) {
  runCli().catch((err) => {
    console.error("❌", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
