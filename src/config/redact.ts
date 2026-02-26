const SECRET_KEYS = ["DISCORD_TOKEN", "OPENAI_API_KEY"] as const;

export function redactConfigSnapshot(obj: unknown): unknown {
  // shallow-ish safe redaction: replaces known secret values anywhere in the tree
  const seen = new WeakSet<object>();

  function walk(v: any): any {
    if (v && typeof v === "object") {
      if (seen.has(v)) return v;
      seen.add(v);

      if (Array.isArray(v)) return v.map(walk);

      const out: Record<string, any> = {};
      for (const [k, val] of Object.entries(v)) {
        if (SECRET_KEYS.includes(k as any)) out[k] = "<redacted>";
        else out[k] = walk(val);
      }
      return out;
    }
    return v;
  }

  return walk(obj);
}
