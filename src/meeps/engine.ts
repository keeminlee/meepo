/**
 * Meep Engine: Shared transaction executor
 * 
 * Centralizes meep balance queries, spending, and crediting so both
 * /meeps and /missions commands use the same deterministic pipeline.
 * 
 * All operations log to ledger and create append-only transactions.
 */

import { log } from "../utils/logger.js";
import { createMeepTx, getMeepBalance as queryBalance } from "./meeps.js";

const meepsLog = log.withScope("meeps");

export const MEEP_MAX_BALANCE = 3;

/**
 * Get current meep balance
 */
export function getBalance(guildId: string, targetDiscordId: string): number {
  return queryBalance(guildId, targetDiscordId);
}

/**
 * Attempt to spend 1 meep
 * @returns true if successful, false if insufficient balance
 */
export function spendMeep(opts: {
  guildId: string;
  invokerDiscordId: string;
  invokerName: string;
  reason?: string;
  meta?: Record<string, unknown>;
}): boolean {
  const balance = getBalance(opts.guildId, opts.invokerDiscordId);
  
  if (balance < 1) {
    return false;
  }

  createMeepTx({
    guild_id: opts.guildId,
    target_discord_id: opts.invokerDiscordId,
    delta: -1,
    issuer_type: "player",
    issuer_discord_id: opts.invokerDiscordId,
    issuer_name: opts.invokerName,
    reason: opts.reason,
    meta: opts.meta,
  });

  return true;
}

/**
 * Attempt to credit 1 meep
 * 
 * Returns:
 *   { success: true, balance: number, txId: string }
 *   { success: false, reason: 'capped' | 'error', balance?: number }
 */
export function creditMeep(opts: {
  guildId: string;
  targetDiscordId: string;
  issuerType: "dm" | "meepo" | "system";
  issuerDiscordId?: string;
  issuerName: string;
  sourceType: "dm" | "mission" | "meepo" | "system";
  sourceRef?: string; // e.g. mission_claim:123, player_reward
  sessionId?: string;
  reason?: string;
  anchor?: {
    sessionId: string;
    lineIndex: number;
  };
  meta?: Record<string, unknown>;
}): { success: boolean; balance?: number; txId?: string; reason?: string } {
  try {
    const balance = getBalance(opts.guildId, opts.targetDiscordId);

    // Check cap
    if (balance >= MEEP_MAX_BALANCE) {
      meepsLog.info(
        `Credit blocked (capped): target=${opts.targetDiscordId}, balance=${balance}, source=${opts.sourceType}`
      );
      return {
        success: false,
        reason: "capped",
        balance,
      };
    }

    // Prepare metadata
    const meta = {
      ...opts.meta,
      source_type: opts.sourceType,
      source_ref: opts.sourceRef,
      session_id: opts.sessionId,
      anchor_session_id: opts.anchor?.sessionId,
      anchor_line_index: opts.anchor?.lineIndex,
    };

    // Create transaction
    const txId = createMeepTx({
      guild_id: opts.guildId,
      target_discord_id: opts.targetDiscordId,
      delta: 1,
      issuer_type: opts.issuerType,
      issuer_discord_id: opts.issuerDiscordId,
      issuer_name: opts.issuerName,
      reason: opts.reason,
      meta,
      source_type: opts.sourceType,
      source_ref: opts.sourceRef,
      session_id: opts.sessionId,
      anchor_session_id: opts.anchor?.sessionId,
      anchor_line_index: opts.anchor?.lineIndex,
    });

    const newBalance = balance + 1;
    meepsLog.info(
      `Credit succeeded: target=${opts.targetDiscordId}, source=${opts.sourceType}, balance=${balance} → ${newBalance}`
    );

    return {
      success: true,
      balance: newBalance,
      txId,
    };
  } catch (err: any) {
    meepsLog.error(`Credit failed: ${err.message ?? err}`);
    return {
      success: false,
      reason: "error",
    };
  }
}
