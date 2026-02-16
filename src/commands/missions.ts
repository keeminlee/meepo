/**
 * /missions command group
 * V0 Mission system integrated with meep economy
 */

import { SlashCommandBuilder, TextChannel } from "discord.js";
import { log } from "../utils/logger.js";
import { getActiveMeepo } from "../meepo/state.js";
import { getDiscordClient } from "../bot.js";
import { getMeepBalance } from "../meeps/meeps.js";
import { creditMeep, MEEP_MAX_BALANCE } from "../meeps/engine.js";
import { getMissionById, listMissions } from "../missions/loadMissions.js";
import { getActiveSessionId } from "../sessions/sessionRuntime.js";
import { getDb } from "../db.js";

const missionsLog = log.withScope("missions");

function isDm(interaction: any): boolean {
  const DM_ROLE_ID = process.env.DM_ROLE_ID || "";
  return interaction.member?.roles?.cache?.has(DM_ROLE_ID) ?? false;
}

function resolvePcFromUser(user: any): { canonical_name: string; discord_user_id: string } | null {
  try {
    const { loadRegistry } = require("../registry/loadRegistry.js");
    const registry = loadRegistry();
    const pc = registry.byDiscordUserId.get(user.id);
    if (!pc) return null;
    return { canonical_name: pc.canonical_name, discord_user_id: pc.discord_user_id! };
  } catch {
    return null;
  }
}

async function handleClaim(interaction: any, guildId: string): Promise<void> {
  if (!isDm(interaction)) {
    await interaction.reply({
      content: "Only the DM can record mission claims, meep!",
      ephemeral: true,
    });
    return;
  }

  const missionId = interaction.options.getString("mission");
  const target = interaction.options.getUser("target");
  const note = interaction.options.getString("note");

  const sessionId = getActiveSessionId(guildId);
  if (!sessionId) {
    await interaction.reply({
      content: "No active session. Use `/session start` first, meep!",
      ephemeral: true,
    });
    return;
  }

  const mission = getMissionById(missionId);
  if (!mission) {
    await interaction.reply({
      content: `Mission not found: ${missionId}. Use \`/missions list\`.`,
      ephemeral: true,
    });
    return;
  }

  const targetPC = resolvePcFromUser(target);
  const db = getDb();
  
  const existing = db
    .prepare(
      `SELECT id FROM mission_claims
       WHERE guild_id = ? AND session_id = ? AND mission_id = ? AND beneficiary_discord_id = ?`
    )
    .get(guildId, sessionId, missionId, target.id) as { id: number } | undefined;

  if (existing) {
    await interaction.reply({
      content: `Already claimed this mission this session, meep!`,
      ephemeral: true,
    });
    return;
  }

  const currentBalance = getMeepBalance(guildId, target.id);

  const claimId = db
    .prepare(`
      INSERT INTO mission_claims (
        guild_id, session_id, mission_id,
        claimant_discord_id, beneficiary_discord_id,
        created_at_ms, status, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(guildId, sessionId, missionId, interaction.user.id, target.id, Date.now(), "claimed", note || null)
    .lastInsertRowid;

  let response = "";
  if (currentBalance >= MEEP_MAX_BALANCE) {
    db.prepare(`UPDATE mission_claims SET status = ? WHERE id = ?`).run("blocked_cap", claimId);
    response = `Mission recorded (capped): ${target.username} maxed at ${MEEP_MAX_BALANCE} meeps, meep!`;
    missionsLog.info(
      `Mission claim blocked (cap): mission=${missionId}, beneficiary=${target.username}, balance=${currentBalance}`
    );
  } else {
    const creditResult = creditMeep({
      guildId,
      targetDiscordId: target.id,
      issuerType: "system",
      issuerName: "Meepo",
      sourceType: "mission",
      sourceRef: `mission_claim:${claimId}`,
      sessionId,
      reason: `Mission: ${mission.name}`,
      meta: { mission_id: missionId, claim_id: claimId },
    });

    if (creditResult.success) {
      db.prepare(`UPDATE mission_claims SET status = ? WHERE id = ?`).run("minted", claimId);
      const newBalance = creditResult.balance!;
      response = `Mission claimed! ${target.username} +1 meep (${currentBalance} → ${newBalance}). ${mission.name}`;

      missionsLog.info(
        `Mission claimed (minted): mission=${missionId}, beneficiary=${target.username}`
      );

      try {
        const meepo = getActiveMeepo(guildId);
        if (meepo) {
          const client = getDiscordClient();
          const channel = (await client.channels.fetch(meepo.channel_id)) as TextChannel;
          if (channel?.isTextBased()) {
            const issuer = interaction.member?.displayName ?? interaction.user.username;
            await channel.send(
              `🎯 ${issuer} recorded: **${mission.name}** for ${targetPC?.canonical_name ?? target.username}`
            );
          }
        }
      } catch (err: any) {
        missionsLog.warn(`Failed to log mission to channel`);
      }
    } else {
      response = `Failed to mint meep, meep!`;
    }
  }

  await interaction.reply({ content: response, ephemeral: true });
}

async function handleStatus(interaction: any, guildId: string): Promise<void> {
  const target = interaction.options.getUser("target");

  if (target && target.id !== interaction.user.id && !isDm(interaction)) {
    await interaction.reply({
      content: "You can only check your own mission status, meep!",
      ephemeral: true,
    });
    return;
  }

  const checkUserId = target?.id ?? interaction.user.id;
  const sessionId = getActiveSessionId(guildId);

  if (!sessionId) {
    await interaction.reply({ content: "No active session, meep!", ephemeral: true });
    return;
  }

  const db = getDb();
  const claims = db
    .prepare(
      `SELECT mission_id, status FROM mission_claims
       WHERE guild_id = ? AND session_id = ? AND beneficiary_discord_id = ?
       ORDER BY created_at_ms DESC`
    )
    .all(guildId, sessionId, checkUserId) as { mission_id: string; status: string }[];

  if (claims.length === 0) {
    await interaction.reply({ content: `No mission claims yet this session, meep!`, ephemeral: true });
    return;
  }

  const lines = claims.map((c) => {
    const mission = getMissionById(c.mission_id);
    const symbol = c.status === "minted" ? "✅" : "⏸️";
    return `${symbol} ${mission?.name || c.mission_id} (${c.status})`;
  });

  const checkName = target?.username ?? "You";
  await interaction.reply({
    content: `**${checkName}** - This Session:\n${lines.join("\n")}`,
    ephemeral: true,
  });
}

async function handleList(interaction: any, guildId: string): Promise<void> {
  const missions = listMissions();

  if (missions.length === 0) {
    await interaction.reply({ content: "No missions configured yet, meep!", ephemeral: true });
    return;
  }

  const lines = missions.map((m) => {
    const reward = m.reward.meeps === 1 ? "1 meep" : `${m.reward.meeps} meeps`;
    const kind = m.kind === "permanent" ? "♻️" : "⏰";
    return `**${m.id}**: ${m.name} — ${reward} ${kind}`;
  });

  await interaction.reply({
    content: `**Available Missions**\n${lines.join("\n")}\n\nUse \`/missions claim mission:<id> target:@player\`.`,
    ephemeral: true,
  });
}

export const missions = {
  data: new SlashCommandBuilder()
    .setName("missions")
    .setDescription("Mission system: track and reward player engagement")
    .addSubcommand((sub) =>
      sub
        .setName("claim")
        .setDescription("(DM-only) Record a mission claim and mint meeps")
        .addStringOption((opt) =>
          opt.setName("mission").setDescription("Mission ID").setRequired(true).setAutocomplete(true)
        )
        .addUserOption((opt) =>
          opt.setName("target").setDescription("Player who completed the mission").setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName("note").setDescription("Optional note").setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("status")
        .setDescription("Check missions claimed this session")
        .addUserOption((opt) =>
          opt.setName("target").setDescription("Check for this player (DM-only for others)").setRequired(false)
        )
    )
    .addSubcommand((sub) => sub.setName("list").setDescription("List all available missions")),

  async execute(interaction: any): Promise<void> {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    switch (subcommand) {
      case "claim":
        await handleClaim(interaction, guildId);
        break;
      case "status":
        await handleStatus(interaction, guildId);
        break;
      case "list":
        await handleList(interaction, guildId);
        break;
    }
  },
};
