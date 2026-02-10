export function isAddressed(messageContent: string, prefix: string): boolean {
  const c = (messageContent ?? "").trim();
  if (!c) return false;

  // prefix check (e.g. "meepo:")
  if (prefix && c.toLowerCase().startsWith(prefix.toLowerCase())) return true;

  return false;
}
