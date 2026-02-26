import { getDbForCampaign } from "../db.js";
import type { GoldCandidateCsvRow, GoldMemoryCsvRow } from "./csvSchema.js";

function groupRowsByCampaign<T extends { campaign_slug: string }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const list = grouped.get(row.campaign_slug) ?? [];
    list.push(row);
    grouped.set(row.campaign_slug, list);
  }
  return grouped;
}

export type RepoDiffSummary = {
  inserted: number;
  updated: number;
  unchanged: number;
};

export function upsertGoldMemories(rows: GoldMemoryCsvRow[]): RepoDiffSummary {
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  const now = Date.now();

  const grouped = groupRowsByCampaign(rows);
  for (const [campaignSlug, campaignRows] of grouped.entries()) {
    const db = getDbForCampaign(campaignSlug);
    const selectStmt = db.prepare(`
      SELECT character, summary, details, tags_json, source_ids_json, gravity, certainty, resilience, status
      FROM gold_memory
      WHERE guild_id = ? AND campaign_slug = ? AND memory_key = ?
    `);
    const upsertStmt = db.prepare(`
      INSERT INTO gold_memory (
        guild_id, campaign_slug, memory_key, character, summary, details, tags_json, source_ids_json,
        gravity, certainty, resilience, status, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, campaign_slug, memory_key) DO UPDATE SET
        character=excluded.character,
        summary=excluded.summary,
        details=excluded.details,
        tags_json=excluded.tags_json,
        source_ids_json=excluded.source_ids_json,
        gravity=excluded.gravity,
        certainty=excluded.certainty,
        resilience=excluded.resilience,
        status=excluded.status,
        updated_at_ms=excluded.updated_at_ms
    `);

    db.transaction(() => {
      for (const row of campaignRows) {
        const tagsJson = JSON.stringify(row.tags);
        const sourceJson = JSON.stringify(row.source_ids);
        const existing = selectStmt.get(row.guild_id, row.campaign_slug, row.memory_key) as any;
        if (!existing) {
          inserted++;
        } else {
          const same =
            existing.character === row.character &&
            existing.summary === row.summary &&
            (existing.details ?? "") === row.details &&
            (existing.tags_json ?? "[]") === tagsJson &&
            (existing.source_ids_json ?? "[]") === sourceJson &&
            Number(existing.gravity) === row.gravity &&
            Number(existing.certainty) === row.certainty &&
            Number(existing.resilience) === row.resilience &&
            existing.status === row.status;
          if (same) {
            unchanged++;
          } else {
            updated++;
          }
        }
        upsertStmt.run(
          row.guild_id,
          row.campaign_slug,
          row.memory_key,
          row.character,
          row.summary,
          row.details,
          tagsJson,
          sourceJson,
          row.gravity,
          row.certainty,
          row.resilience,
          row.status,
          now,
        );
      }
    })();
  }

  return { inserted, updated, unchanged };
}

export function upsertGoldCandidates(rows: GoldCandidateCsvRow[], sessionId?: string | null): RepoDiffSummary {
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  const now = Date.now();

  const grouped = groupRowsByCampaign(rows);
  for (const [campaignSlug, campaignRows] of grouped.entries()) {
    const db = getDbForCampaign(campaignSlug);
    const selectStmt = db.prepare(`
      SELECT session_id, character, summary, details, tags_json, source_ids_json, gravity, certainty, resilience, status
      FROM gold_memory_candidate
      WHERE guild_id = ? AND campaign_slug = ? AND candidate_key = ?
    `);
    const upsertStmt = db.prepare(`
      INSERT INTO gold_memory_candidate (
        guild_id, campaign_slug, candidate_key, session_id, character, summary, details, tags_json, source_ids_json,
        gravity, certainty, resilience, status, reviewed_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
      ON CONFLICT(guild_id, campaign_slug, candidate_key) DO UPDATE SET
        session_id=excluded.session_id,
        character=excluded.character,
        summary=excluded.summary,
        details=excluded.details,
        tags_json=excluded.tags_json,
        source_ids_json=excluded.source_ids_json,
        gravity=excluded.gravity,
        certainty=excluded.certainty,
        resilience=excluded.resilience,
        status=excluded.status,
        updated_at_ms=excluded.updated_at_ms
    `);

    db.transaction(() => {
      for (const row of campaignRows) {
        const tagsJson = JSON.stringify(row.tags);
        const sourceJson = JSON.stringify(row.source_ids);
        const resolvedSessionId = row.session_id ?? sessionId ?? null;
        const existing = selectStmt.get(row.guild_id, row.campaign_slug, row.candidate_key) as any;
        if (!existing) {
          inserted++;
        } else {
          const same =
            (existing.session_id ?? null) === resolvedSessionId &&
            existing.character === row.character &&
            existing.summary === row.summary &&
            (existing.details ?? "") === row.details &&
            (existing.tags_json ?? "[]") === tagsJson &&
            (existing.source_ids_json ?? "[]") === sourceJson &&
            Number(existing.gravity) === row.gravity &&
            Number(existing.certainty) === row.certainty &&
            Number(existing.resilience) === row.resilience &&
            existing.status === row.status;
          if (same) unchanged++;
          else updated++;
        }
        upsertStmt.run(
          row.guild_id,
          row.campaign_slug,
          row.candidate_key,
          resolvedSessionId,
          row.character,
          row.summary,
          row.details,
          tagsJson,
          sourceJson,
          row.gravity,
          row.certainty,
          row.resilience,
          row.status,
          now,
        );
      }
    })();
  }

  return { inserted, updated, unchanged };
}

export function promoteCandidates(input: {
  guildId: string;
  campaignSlug: string;
  candidateKeys: string[];
}): number {
  const db = getDbForCampaign(input.campaignSlug);
  let promoted = 0;
  const now = Date.now();

  db.transaction(() => {
    const select = db.prepare(`
      SELECT guild_id, campaign_slug, candidate_key, character, summary, details, tags_json, source_ids_json, gravity, certainty, resilience
      FROM gold_memory_candidate
      WHERE guild_id = ? AND campaign_slug = ? AND candidate_key = ?
    `);
    const upsertGold = db.prepare(`
      INSERT INTO gold_memory (
        guild_id, campaign_slug, memory_key, character, summary, details, tags_json, source_ids_json,
        gravity, certainty, resilience, status, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
      ON CONFLICT(guild_id, campaign_slug, memory_key) DO UPDATE SET
        character=excluded.character,
        summary=excluded.summary,
        details=excluded.details,
        tags_json=excluded.tags_json,
        source_ids_json=excluded.source_ids_json,
        gravity=excluded.gravity,
        certainty=excluded.certainty,
        resilience=excluded.resilience,
        status='active',
        updated_at_ms=excluded.updated_at_ms
    `);
    const markCandidate = db.prepare(`
      UPDATE gold_memory_candidate
      SET status = 'approved', reviewed_at_ms = ?, updated_at_ms = ?
      WHERE guild_id = ? AND campaign_slug = ? AND candidate_key = ?
    `);
    for (const key of input.candidateKeys) {
      const row = select.get(input.guildId, input.campaignSlug, key) as any;
      if (!row) continue;
      upsertGold.run(
        row.guild_id,
        row.campaign_slug,
        row.candidate_key,
        row.character,
        row.summary,
        row.details ?? "",
        row.tags_json ?? "[]",
        row.source_ids_json ?? "[]",
        Number(row.gravity ?? 1),
        Number(row.certainty ?? 1),
        Number(row.resilience ?? 1),
        now,
      );
      markCandidate.run(now, now, input.guildId, input.campaignSlug, key);
      promoted++;
    }
  })();

  return promoted;
}

export function getGoldMemoriesForQuery(opts: {
  guildId: string;
  campaignSlug: string;
  query: string;
  limit?: number;
}): Array<{
  memory_key: string;
  character: string;
  summary: string;
  gravity: number;
  certainty: number;
  resilience: number;
  score: number;
}> {
  const db = getDbForCampaign(opts.campaignSlug);
  const q = opts.query.trim().toLowerCase();
  if (!q) return [];
  const rows = db.prepare(`
    SELECT memory_key, character, summary, details, tags_json, gravity, certainty, resilience
    FROM gold_memory
    WHERE guild_id = ? AND campaign_slug = ? AND status = 'active'
  `).all(opts.guildId, opts.campaignSlug) as any[];

  const scored = rows
    .map((r) => {
      const tags = (() => {
        try {
          return JSON.parse(r.tags_json ?? "[]") as string[];
        } catch {
          return [];
        }
      })();
      const hay = `${r.character} ${r.summary} ${r.details ?? ""} ${tags.join(" ")}`.toLowerCase();
      const hit = hay.includes(q);
      let score = 0;
      if (hit) score += 1;
      const words = q.split(/\s+/).filter(Boolean);
      for (const w of words) {
        if (w.length < 2) continue;
        if (hay.includes(w)) score += 0.2;
      }
      score += Number(r.gravity ?? 0) * 0.3 + Number(r.certainty ?? 0) * 0.2 + Number(r.resilience ?? 0) * 0.1;
      return {
        memory_key: r.memory_key as string,
        character: r.character as string,
        summary: r.summary as string,
        gravity: Number(r.gravity ?? 0),
        certainty: Number(r.certainty ?? 0),
        resilience: Number(r.resilience ?? 0),
        score,
      };
    })
    .filter((r) => r.score > 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 5);

  return scored;
}
