import { WebDataError } from "@/lib/mappers/errorMappers";
import { getGuildWriteAuthorityState } from "@/lib/server/readData/archiveReadStore";

export function canUserWriteGuildArchive(args: {
  guildId: string;
  userId?: string | null;
}): boolean {
  const userId = args.userId?.trim();
  if (!userId) return false;

  const authority = getGuildWriteAuthorityState(args.guildId);
  const dmUserId = authority.dmUserId?.trim();
  if (!dmUserId) return false;
  return dmUserId === userId;
}

export function assertUserCanWriteGuildArchive(args: {
  guildId: string;
  userId?: string | null;
}): void {
  if (canUserWriteGuildArchive(args)) {
    return;
  }

  throw new WebDataError(
    "unauthorized",
    403,
    "Write access is restricted to the guild DM for this archive scope."
  );
}
