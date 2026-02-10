export function isAddressed(messageContent: string, prefix: string): boolean {
  const c = (messageContent ?? "").trim();
  if (!c) return false;

  // prefix check (e.g. "meepo:")
  if (prefix && c.toLowerCase().startsWith(prefix.toLowerCase())) return true;

  // Also count as addressed if message contains "meepo" anywhere
  if (c.toLowerCase().includes("meepo")) return true;

  return false;
}
