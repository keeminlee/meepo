import "dotenv/config";
import { cfg } from "../config/env.js";
import { redactConfigSnapshot } from "../config/redact.js";
import { getDefaultCampaignSlug } from "../campaign/defaultCampaign.js";
import {
  resolveCampaignCacheDir,
  resolveCampaignDataRoot,
  resolveCampaignDbPath,
  resolveCampaignExportsDir,
  resolveCampaignRunsDir,
  resolveCampaignTranscriptsDir,
} from "../dataPaths.js";
import { getControlDb, getDbForCampaign } from "../db.js";
import path from "node:path";

function main(): void {
  const defaultCampaignSlug = getDefaultCampaignSlug();
  const dbPath = resolveCampaignDbPath(defaultCampaignSlug);
  const controlDbPath = path.resolve(cfg.data.root, "control", "control.sqlite");

  console.log("=== MEEPO DOCTOR ===");
  console.log(
    JSON.stringify(
      {
        config: redactConfigSnapshot({
          mode: cfg.mode,
          discord: {
            token: "<redacted>",
            dmRoleId: cfg.discord.dmRoleId,
            clientId: cfg.discord.clientId,
            guildId: cfg.discord.guildId,
            botPrefix: cfg.discord.botPrefix,
          },
          db: cfg.db,
          data: cfg.data,
          session: cfg.session,
          llm: cfg.llm,
          overlay: cfg.overlay,
          voice: cfg.voice,
          stt: cfg.stt,
          tts: cfg.tts,
          audioFx: cfg.audioFx,
          features: cfg.features,
          logging: cfg.logging,
          openai: { apiKey: "<redacted>" },
        }),
      },
      null,
      2,
    ),
  );

  console.log(
    JSON.stringify(
      {
        defaultCampaign: {
          campaignSlug: defaultCampaignSlug,
          dataRoot: resolveCampaignDataRoot(defaultCampaignSlug),
          dbPath,
          transcriptsDir: resolveCampaignTranscriptsDir(defaultCampaignSlug, { forWrite: false }),
          runsDir: resolveCampaignRunsDir(defaultCampaignSlug, { forWrite: false }),
          exportsDir: resolveCampaignExportsDir(defaultCampaignSlug, { forWrite: false }),
          cacheDir: resolveCampaignCacheDir(defaultCampaignSlug, { forWrite: false }),
        },
      },
      null,
      2,
    ),
  );

  const db = getDbForCampaign(defaultCampaignSlug);
  const controlDb = getControlDb();
  const canOpen = db.prepare("SELECT 1 as ok").get() as { ok: number };
  const canOpenControl = controlDb.prepare("SELECT 1 as ok").get() as { ok: number };
  const schemaVersion = db.pragma("user_version", { simple: true }) as number;
  const controlSchemaVersion = controlDb.pragma("user_version", { simple: true }) as number;
  const tableCount = (db
    .prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .get() as { count: number }).count;
  const controlTableCount = (controlDb
    .prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .get() as { count: number }).count;

  console.log(
    JSON.stringify(
      {
        dbHealth: {
          control: {
            canOpenDb: canOpenControl.ok === 1,
            dbPath: controlDbPath,
            schemaVersion: controlSchemaVersion,
            tableCount: controlTableCount,
          },
          campaign: {
          canOpenDb: canOpen.ok === 1,
          dbPath,
          schemaVersion,
          tableCount,
          },
        },
      },
      null,
      2,
    ),
  );
  console.log("=== DOCTOR OK ===");
}

main();