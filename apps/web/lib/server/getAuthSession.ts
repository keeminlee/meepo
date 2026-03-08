import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/server/authOptions";

export async function getAuthSession() {
  return getServerSession(authOptions);
}
