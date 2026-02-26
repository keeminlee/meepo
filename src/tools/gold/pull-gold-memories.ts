import "dotenv/config";
import path from "node:path";
import { getDb } from "../../db.js";
import { writeCsvRows } from "../../gold/csvIO.js";
import {
  GOLD_MEMORY_COLUMNS,
  type GoldMemoryCsvRow,
  serializeGoldMemoryCsvRow,
} from "../../gold/csvSchema.js";
import { resolveCampaignSlug } from "../../campaign/guildConfig.js";
import { getEnv } from "../../config/rawEnv.js";

function parseArgs(): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = process.argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function main(): void {
  const args = parseArgs();
  const guildId = String(args.guild ?? getEnv("GUILD_ID", "") ?? "").trim();
  if (!guildId) {
    throw new Error("Missing --guild <guild_id> (or GUILD_ID env)");
  }
  const campaignSlug = String(args.campaign ?? resolveCampaignSlug({ guildId })).trim();
  const outPath = String(args.out ?? path.join("data", campaignSlug, "gold_memories.csv"));

  const db = getDb();
  const rows = db.prepare(`
    SELECT guild_id, campaign_slug, memory_key, character, summary, details, tags_json, source_ids_json, gravity, certainty, resilience, status
    FROM gold_memory
    WHERE guild_id = ? AND campaign_slug = ?
    ORDER BY character ASC, memory_key ASC
  `).all(guildId, campaignSlug) as any[];

  const csvRows = rows.map((r) => {
    const normalized: GoldMemoryCsvRow = {
      guild_id: r.guild_id,
      campaign_slug: r.campaign_slug,
      memory_key: r.memory_key,
      character: r.character,
      summary: r.summary,
      details: r.details ?? "",
      tags: (() => {
        try {
          return JSON.parse(r.tags_json ?? "[]") as string[];
        } catch {
          return [];
        }
      })(),
      source_ids: (() => {
        try {
          return JSON.parse(r.source_ids_json ?? "[]") as string[];
        } catch {
          return [];
        }
      })(),
      gravity: Number(r.gravity ?? 1),
      certainty: Number(r.certainty ?? 1),
      resilience: Number(r.resilience ?? 1),
      status: r.status ?? "active",
    };
    return serializeGoldMemoryCsvRow(normalized);
  });

  writeCsvRows(outPath, [...GOLD_MEMORY_COLUMNS], csvRows);
  console.log(`Pulled ${csvRows.length} gold memories -> ${outPath}`);
}

main();
