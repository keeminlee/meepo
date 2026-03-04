import { cfg } from "../config/env.js";
import { getDbForCampaign } from "../db.js";
import { resolveCampaignSlug } from "../campaign/guildConfig.js";
import { log } from "../utils/logger.js";
import { getMeepoContextQueueStatus, processMeepoContextActionsTick } from "./meepoContextActions.js";

const workerLog = log.withScope("meepo-context-worker");
let workerTimer: NodeJS.Timeout | null = null;

function getWorkerDb(guildId?: string | null): any {
  const campaignSlug = resolveCampaignSlug({ guildId: guildId ?? cfg.discord.guildId ?? undefined });
  return getDbForCampaign(campaignSlug);
}

export async function runMeepoContextActionWorkerTick(guildId?: string | null): Promise<void> {
  if (!cfg.features.contextWorkerEnabled) return;
  const db = getWorkerDb(guildId);
  const result = await processMeepoContextActionsTick(db, "worker", {
    maxActionsPerTick: cfg.meepoContextActions.maxActionsPerTick,
    maxTotalRuntimeMs: cfg.meepoContextActions.maxTotalRuntimeMs,
    leaseTtlMs: cfg.meepoContextActions.leaseTtlMs,
    maxAttempts: cfg.meepoContextActions.maxAttempts,
    retryBaseMs: cfg.meepoContextActions.retryBaseMs,
  });
  if (result.processed > 0) {
    workerLog.debug(
      `tick processed=${result.processed} succeeded=${result.succeeded} failed=${result.failed} timedOut=${result.timedOut} elapsedMs=${result.elapsedMs}`
    );
  }
}

export function startMeepoContextActionWorker(guildId?: string | null): void {
  if (!cfg.features.contextWorkerEnabled) {
    workerLog.info("disabled");
    return;
  }
  if (workerTimer) return;
  const intervalMs = cfg.meepoContextActions.pollMs;
  workerTimer = setInterval(async () => {
    try {
      await runMeepoContextActionWorkerTick(guildId);
    } catch (error: any) {
      workerLog.error(`tick_error ${error?.message ?? error}`);
    }
  }, intervalMs);
  workerLog.info(`started pollMs=${intervalMs}`);
}

export function stopMeepoContextActionWorker(): void {
  if (!workerTimer) return;
  clearInterval(workerTimer);
  workerTimer = null;
  workerLog.info("stopped");
}

export function getMeepoContextWorkerStatus(guildId?: string | null): {
  enabled: boolean;
  running: boolean;
  queue: ReturnType<typeof getMeepoContextQueueStatus>;
} {
  const db = getWorkerDb(guildId);
  return {
    enabled: cfg.features.contextWorkerEnabled,
    running: Boolean(workerTimer),
    queue: getMeepoContextQueueStatus(db),
  };
}
