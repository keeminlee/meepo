export function getEnv(name: string, fallback?: string): string | undefined {
  const value = process.env[name];
  if (value == null || value.trim() === "") {
    return fallback;
  }
  return value.trim();
}

export function getEnvBool(name: string, fallback: boolean): boolean {
  const value = getEnv(name);
  if (!value) return fallback;
  const normalized = value.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

export function getEnvNumber(name: string, fallback: number): number {
  const value = getEnv(name);
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
