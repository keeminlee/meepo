/**
 * Meep Transactions Module
 * Append-only ledger for meep balance tracking (guild-scoped)
 * 
 * Meeps are player-earned progression tokens (max 3 per PC)
 * - Spend (player action): delta = -1, issuer_type = 'player'
 * - Reward (DM action): delta = +1, issuer_type = 'dm'
 * - Auto-reward (future): delta = +1, issuer_type = 'meepo'
 */

import { randomUUID } from 'crypto';
import { log } from '../utils/logger.js';
import { getDbForCampaign } from '../db.js';
import { resolveCampaignSlug } from '../campaign/guildConfig.js';

const meepsLog = log.withScope("meeps");

function getMeepsDbForGuild(guildId: string) {
  const campaignSlug = resolveCampaignSlug({ guildId });
  return getDbForCampaign(campaignSlug);
}

export type IssuerType = 'dm' | 'player' | 'meepo' | 'system';

export interface MeepTransaction {
  id: number;
  guild_id: string;
  tx_id: string;
  created_at_ms: number;
  target_discord_id: string;
  delta: number;
  issuer_type: IssuerType;
  issuer_discord_id: string | null;
  issuer_name: string;
  reason: string | null;
  meta_json: string | null;
  source_type?: string;         // 'dm' | 'mission' | 'meepo' | 'system' | 'player_spend'
  source_ref?: string | null;   // e.g., mission_claim:123
  session_id?: string | null;   // Session this meep was earned in
  anchor_session_id?: string | null;
  anchor_line_index?: number | null;
}

/**
 * Create a meep transaction
 * @returns tx_id (UUID)
 */
export function createMeepTx(opts: {
  guild_id: string;
  target_discord_id: string;
  delta: number;  // Always ±1
  issuer_type: IssuerType;
  issuer_discord_id?: string | null;
  issuer_name: string;
  reason?: string;
  meta?: Record<string, unknown>;
  source_type?: string;
  source_ref?: string;
  session_id?: string;
  anchor_session_id?: string;
  anchor_line_index?: number;
}): string {
  const db = getMeepsDbForGuild(opts.guild_id);
  const tx_id = randomUUID();
  const now = Date.now();

  db.prepare(`
    INSERT INTO meep_transactions (
      guild_id, tx_id, created_at_ms, target_discord_id, delta,
      issuer_type, issuer_discord_id, issuer_name, reason, meta_json,
      source_type, source_ref, session_id, anchor_session_id, anchor_line_index
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    opts.guild_id,
    tx_id,
    now,
    opts.target_discord_id,
    opts.delta,
    opts.issuer_type,
    opts.issuer_discord_id ?? null,
    opts.issuer_name,
    opts.reason ?? null,
    opts.meta ? JSON.stringify(opts.meta) : null,
    opts.source_type ?? 'dm',
    opts.source_ref ?? null,
    opts.session_id ?? null,
    opts.anchor_session_id ?? null,
    opts.anchor_line_index ?? null
  );

  meepsLog.debug(`Created transaction: delta=${opts.delta}, issuer=${opts.issuer_type}, issuer_name=${opts.issuer_name}`);

  return tx_id;
}

/**
 * Get current meep balance for a PC (sum of all transactions)
 * @returns balance (0 if no transactions)
 */
export function getMeepBalance(guild_id: string, target_discord_id: string): number {
  const db = getMeepsDbForGuild(guild_id);
  const result = db.prepare(`
    SELECT COALESCE(SUM(delta), 0) as balance
    FROM meep_transactions
    WHERE guild_id = ? AND target_discord_id = ?
  `).get(guild_id, target_discord_id) as { balance: number } | undefined;

  return result?.balance ?? 0;
}

/**
 * Get transaction history for a PC (most recent first)
 */
export function getMeepHistory(
  guild_id: string,
  target_discord_id: string,
  limit: number = 10
): MeepTransaction[] {
  const db = getMeepsDbForGuild(guild_id);
  const rows = db.prepare(`
    SELECT * FROM meep_transactions
    WHERE guild_id = ? AND target_discord_id = ?
    ORDER BY created_at_ms DESC
    LIMIT ?
  `).all(guild_id, target_discord_id, limit) as MeepTransaction[];

  return rows;
}

/**
 * Format a meep transaction for display in Discord replies
 */
export function formatMeepReceipt(balance: number, action: 'spend' | 'reward', target?: string): string {
  const maxBalance = 3;
  const balanceStr = `${balance}/${maxBalance}`;

  if (action === 'spend') {
    return `Meep spent! You now have ${balanceStr} meeps.`;
  } else {
    return `Meep granted${target ? ` to ${target}` : ''}! They now have ${balanceStr} meeps.`;
  }
}

/**
 * Format meep history for display
 */
export function formatMeepHistory(txs: MeepTransaction[]): string {
  if (txs.length === 0) {
    return 'No meep transactions yet.';
  }

  const lines = txs.map(tx => {
    const symbol = tx.delta > 0 ? '+' : '';
    const issuer = tx.issuer_type === 'meepo' ? 'Meepo' : (tx.issuer_name || 'Unknown');
    const relativeTime = formatRelativeTime(tx.created_at_ms);
    return `${symbol}${tx.delta} — ${relativeTime} — ${issuer}`;
  });

  return '```\n' + lines.join('\n') + '\n```';
}

/**
 * Format timestamp as relative time (e.g., "2 hours ago")
 */
function formatRelativeTime(ms: number): string {
  const now = Date.now();
  const diff = now - ms;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

/**
 * Auto-reward Meepo (stub for future use)
 * Called from session completion, beat discovery, etc.
 * 
 * @param target_discord_id Discord ID of PC to reward
 * @param reason Optional reason (e.g., "Session completion", "Beat discovery")
 * @param meta Optional metadata
 * @returns tx_id
 */
export function autoRewardMeep(opts: {
  target_discord_id: string;
  guild_id: string;
  reason?: string;
  meta?: Record<string, unknown>;
}): string {
  // Future: This will be called from:
  // - Session end (unconditional)
  // - Meecap beat discovery (conditional)
  // - DM-triggered narrative moments
  //
  // For now, this is a stub. The function signature is ready for integration.

  return createMeepTx({
    guild_id: opts.guild_id,
    target_discord_id: opts.target_discord_id,
    delta: 1,
    issuer_type: 'meepo',
    issuer_discord_id: null,
    issuer_name: 'Meepo',
    reason: opts.reason,
    meta: opts.meta,
  });
}
