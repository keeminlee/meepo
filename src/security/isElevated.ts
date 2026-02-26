import { GuildMember, PermissionFlagsBits } from "discord.js";
import { cfg } from "../config/env.js";

export function isElevated(member: GuildMember | null): boolean {
  if (!member) return false;

  if (member.guild.ownerId === member.id) return true;

  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;

  const dmRoleId = cfg.discord.dmRoleId;
  if (dmRoleId && member.roles.cache.has(dmRoleId)) return true;

  return false;
}