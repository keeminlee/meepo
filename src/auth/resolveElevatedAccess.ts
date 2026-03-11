import { PermissionFlagsBits, type GuildMember } from "discord.js";
import { getGuildDmRoleId, getGuildDmUserId } from "../campaign/guildConfig.js";
import { cfg } from "../config/env.js";
import { isDevUser } from "../security/devAccess.js";

export type ElevatedSurface = "dm" | "dev";

export type InteractionContext = {
  guildId: string | null | undefined;
  userId: string | null | undefined;
  member: GuildMember | any | null | undefined;
};

function hasRole(member: InteractionContext["member"], roleId: string): boolean {
  const roles = member?.roles;
  if (!roles) return false;
  if (Array.isArray(roles)) return roles.includes(roleId);
  if (Array.isArray(roles.cache)) return roles.cache.includes(roleId);
  if (typeof roles.cache?.has === "function") return Boolean(roles.cache.has(roleId));
  if (Array.isArray(roles.value)) return roles.value.includes(roleId);
  return false;
}

function isDiscordAdmin(member: InteractionContext["member"]): boolean {
  if (!member) return false;
  if (member.guild?.ownerId && member.id && member.guild.ownerId === member.id) return true;
  return Boolean(member.permissions?.has?.(PermissionFlagsBits.Administrator));
}

export function hasGuildOperationalAccess(ctx: InteractionContext): boolean {
  const userId = ctx.userId?.trim();
  if (!userId) return false;

  if (isDiscordAdmin(ctx.member)) return true;

  const guildId = ctx.guildId?.trim() ?? "";
  if (guildId.length > 0) {
    const guildDmUserId = getGuildDmUserId(guildId);
    if (guildDmUserId && guildDmUserId === userId) return true;

    const guildDmRoleId = getGuildDmRoleId(guildId);
    if (guildDmRoleId && hasRole(ctx.member, guildDmRoleId)) return true;
  }

  const globalDmUserIds = Array.isArray(cfg.access?.dmUserIds) ? cfg.access.dmUserIds : [];
  if (globalDmUserIds.includes(userId)) return true;

  // Compatibility fallback only: prefer guild-config dm_role_id first.
  const fallbackDmRoleId = cfg.discord?.dmRoleId?.trim();
  if (fallbackDmRoleId && hasRole(ctx.member, fallbackDmRoleId)) return true;

  return false;
}

export function isElevatedForSurface(surface: ElevatedSurface, ctx: InteractionContext): boolean {
  if (surface === "dev") {
    return isDevUser(ctx.userId);
  }
  return hasGuildOperationalAccess(ctx);
}
