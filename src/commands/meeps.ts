/**
 * /meeps command group
 * Bookkeeping system for meep balance (player progression tokens)
 * 
 * Subcommands:
 * - spend: Player spends 1 meep from self
 * - reward (DM-only): DM grants 1 meep to target PC
 * - balance: Check self or other PC balance
 * - history: View transaction history for self or other PC
 */

import { SlashCommandBuilder } from 'discord.js';
import { loadRegistry } from '../registry/loadRegistry.js';
import {
  createMeepTx,
  getMeepBalance,
  getMeepHistory,
  formatMeepReceipt,
  formatMeepHistory,
} from '../meeps/meeps.js';

/**
 * Resolve a Discord user to a registered PC
 * @returns {canonical_name, discord_user_id} or null if not found
 */
function resolvePcFromUser(user: any): { canonical_name: string; discord_user_id: string } | null {
  const registry = loadRegistry();
  const pc = registry.byDiscordUserId.get(user.id);
  if (!pc) {
    return null;
  }
  return {
    canonical_name: pc.canonical_name,
    discord_user_id: pc.discord_user_id!,
  };
}

/**
 * Check if interaction user is DM (has DM_ROLE_ID)
 */
function isDm(interaction: any): boolean {
  const dmRoleId = process.env.DM_ROLE_ID;
  if (!dmRoleId) return false;
  const member = interaction.member;
  return member?.roles?.cache?.has(dmRoleId) ?? false;
}

export const meeps = {
  data: new SlashCommandBuilder()
    .setName('meeps')
    .setDescription('Manage meep balance (player progression tokens).')
    .addSubcommand((sub) =>
      sub
        .setName('spend')
        .setDescription('Spend 1 meep (remove from your balance).')
    )
    .addSubcommand((sub) =>
      sub
        .setName('reward')
        .setDescription('[DM-only] Grant 1 meep to a player.')
        .addUserOption((opt) =>
          opt
            .setName('target')
            .setDescription('Player to grant meep to')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('balance')
        .setDescription('Check meep balance (yours or another player).')
        .addUserOption((opt) =>
          opt
            .setName('target')
            .setDescription('Player to check (DM-only to check others)')
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('history')
        .setDescription('View meep transaction history.')
        .addUserOption((opt) =>
          opt
            .setName('target')
            .setDescription('Player to view history for (DM-only to check others)')
            .setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('limit')
            .setDescription('Number of transactions to show (default 10)')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(50)
        )
    ),

  async execute(interaction: any) {
    const guildId = interaction.guildId as string;
    const sub = interaction.options.getSubcommand();

    if (sub === 'spend') {
      await handleSpend(interaction, guildId);
    } else if (sub === 'reward') {
      await handleReward(interaction, guildId);
    } else if (sub === 'balance') {
      await handleBalance(interaction, guildId);
    } else if (sub === 'history') {
      await handleHistory(interaction, guildId);
    }
  },
};

/**
 * /meeps spend
 * Player spends 1 meep from their balance
 */
async function handleSpend(interaction: any, guildId: string): Promise<void> {
  const invoker = interaction.user;
  const invokerPC = resolvePcFromUser(invoker);

  if (!invokerPC) {
    // Not a registered PC - allow any Discord user to have a meep balance
    // (design choice: meeps track per-Discord-ID, not just per-PC)
  }

  const currentBalance = getMeepBalance(guildId, invoker.id);

  // Guardrail: Insufficient balance
  if (currentBalance < 1) {
    await interaction.reply({
      content: 'No meeps... come back once you find some more, meep!',
      ephemeral: true,
    });
    return;
  }

  // Create transaction
  createMeepTx({
    guild_id: guildId,
    target_discord_id: invoker.id,
    delta: -1,
    issuer_type: 'player',
    issuer_discord_id: invoker.id,
    issuer_name: interaction.member?.displayName ?? invoker.username,
  });

  const newBalance = currentBalance - 1;
  const response = formatMeepReceipt(newBalance, 'spend');

  await interaction.reply({
    content: response,
    ephemeral: true,
  });
}

/**
 * /meeps reward
 * DM grants 1 meep to target PC
 */
async function handleReward(interaction: any, guildId: string): Promise<void> {
  // Guard: DM-only
  if (!isDm(interaction)) {
    await interaction.reply({
      content: 'You can only check your own balance, meep!',
      ephemeral: true,
    });
    return;
  }

  const target = interaction.options.getUser('target');

  // Resolve target to PC
  const targetPC = resolvePcFromUser(target);
  if (!targetPC) {
    await interaction.reply({
      content: `I don't know who that is yet… add them to the registry first, meep.`,
      ephemeral: true,
    });
    return;
  }

  const currentBalance = getMeepBalance(guildId, target.id);

  // Guardrail: Already at cap
  if (currentBalance >= 3) {
    await interaction.reply({
      content: `They're already maxed out (3 meeps), meep!`,
      ephemeral: true,
    });
    return;
  }

  // Create transaction
  const dm = interaction.member;
  createMeepTx({
    guild_id: guildId,
    target_discord_id: target.id,
    delta: 1,
    issuer_type: 'dm',
    issuer_discord_id: interaction.user.id,
    issuer_name: dm?.displayName ?? interaction.user.username,
  });

  const newBalance = currentBalance + 1;
  const response = formatMeepReceipt(newBalance, 'reward', targetPC.canonical_name);

  await interaction.reply({
    content: response,
    ephemeral: true,
  });
}

/**
 * /meeps balance
 * Check meep balance for self or another PC (DM-only for others)
 */
async function handleBalance(interaction: any, guildId: string): Promise<void> {
  const target = interaction.options.getUser('target');
  const invoker = interaction.user;

  // Default to invoker if no target specified
  const checkUser = target ?? invoker;
  const checkPC = resolvePcFromUser(checkUser);

  // Guard: Non-DM checking someone else's balance
  if (target && !isDm(interaction)) {
    await interaction.reply({
      content: 'You can only check your own balance, meep!',
      ephemeral: true,
    });
    return;
  }

  const balance = getMeepBalance(guildId, checkUser.id);
  const maxBalance = 3;

  let response: string;
  if (checkUser.id === invoker.id) {
    response = `You have ${balance}/${maxBalance} meeps.`;
  } else {
    response = `${checkPC?.canonical_name ?? checkUser.username} has ${balance}/${maxBalance} meeps.`;
  }

  await interaction.reply({
    content: response,
    ephemeral: true,
  });
}

/**
 * /meeps history
 * View transaction history for self or another PC (DM-only for others)
 */
async function handleHistory(interaction: any, guildId: string): Promise<void> {
  const target = interaction.options.getUser('target');
  const limit = interaction.options.getInteger('limit') ?? 10;
  const invoker = interaction.user;

  // Default to invoker if no target specified
  const checkUser = target ?? invoker;
  const checkPC = resolvePcFromUser(checkUser);

  // Guard: Non-DM checking someone else's history
  if (target && !isDm(interaction)) {
    await interaction.reply({
      content: 'You can only check your own history, meep!',
      ephemeral: true,
    });
    return;
  }

  const txs = getMeepHistory(guildId, checkUser.id, limit);
  const historyText = formatMeepHistory(txs);

  let title: string;
  if (checkUser.id === invoker.id) {
    title = 'Your meep history:';
  } else {
    title = `${checkPC?.canonical_name ?? checkUser.username}'s meep history:`;
  }

  await interaction.reply({
    content: `${title}\n${historyText}`,
    ephemeral: true,
  });
}
