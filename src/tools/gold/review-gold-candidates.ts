import "dotenv/config";
import { getDb } from "../../db.js";
import { promoteCandidates } from "../../gold/goldMemoryRepo.js";
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
  if (!guildId) throw new Error("Missing --guild <guild_id> (or GUILD_ID env)");
  const campaignSlug = String(args.campaign ?? resolveCampaignSlug({ guildId })).trim();
  const action = String(args.action ?? "list").trim();
  const keys = String(args.keys ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  const db = getDb();
  if (action === "list") {
    const pending = db.prepare(`
      SELECT candidate_key, character, summary, status, updated_at_ms
      FROM gold_memory_candidate
      WHERE guild_id = ? AND campaign_slug = ? AND status = 'pending'
      ORDER BY updated_at_ms DESC
      LIMIT 100
    `).all(guildId, campaignSlug) as any[];
    if (pending.length === 0) {
      console.log("No pending candidates.");
      return;
    }
    for (const row of pending) {
      console.log(`- ${row.candidate_key} | ${row.character} | ${row.summary}`);
    }
    return;
  }

  if (keys.length === 0) throw new Error("Provide --keys key1,key2,...");

  if (action === "approve") {
    const promoted = promoteCandidates({ guildId, campaignSlug, candidateKeys: keys });
    console.log(`Approved/promoted ${promoted} candidates.`);
    return;
  }

  if (action === "reject") {
    const now = Date.now();
    const stmt = db.prepare(`
      UPDATE gold_memory_candidate
      SET status = 'rejected', reviewed_at_ms = ?, updated_at_ms = ?
      WHERE guild_id = ? AND campaign_slug = ? AND candidate_key = ?
    `);
    let changed = 0;
    for (const key of keys) {
      const info = stmt.run(now, now, guildId, campaignSlug, key);
      changed += info.changes;
    }
    console.log(`Rejected ${changed} candidates.`);
    return;
  }

  throw new Error(`Unknown --action: ${action}`);
}

main();
