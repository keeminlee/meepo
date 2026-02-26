import type { MeepoMode } from "../config/types.js";
import { cfg } from "../config/env.js";
import { resolveCampaignSlug } from "../campaign/guildConfig.js";
import { getLegacyFallbacksThisBoot } from "../dataPaths.js";
import { log } from "../utils/logger.js";

const runtimeLog = log.withScope("runtime");

export function logRuntimeContextBanner(args: {
  entrypoint: string;
  guildId: string | null;
  guildName?: string | null;
  mode: MeepoMode;
  dbPath?: string;
}): void {
  const campaignSlug = resolveCampaignSlug({
    guildId: args.guildId ?? undefined,
    guildName: args.guildName ?? undefined,
  });

  runtimeLog.info(
    `RuntimeContext ${JSON.stringify({
      entrypoint: args.entrypoint,
      guildId: args.guildId,
      campaignSlug,
      mode: args.mode,
      dbPath: args.dbPath ?? cfg.db.path,
      legacyFallbacksThisBoot: getLegacyFallbacksThisBoot(),
    })}`,
  );
}