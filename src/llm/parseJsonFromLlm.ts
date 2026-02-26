export function parseJsonFromLlm(raw: string): unknown {
  const trimmed = raw.trim();

  const direct = tryParse(trimmed);
  if (direct.ok) return direct.value;

  const fenced = extractFencedContent(trimmed);
  if (fenced) {
    const parsed = tryParse(fenced);
    if (parsed.ok) return parsed.value;
  }

  const arraySlice = extractBracketSlice(trimmed, "[", "]");
  if (arraySlice) {
    const parsed = tryParse(arraySlice);
    if (parsed.ok) return parsed.value;
  }

  const objectSlice = extractBracketSlice(trimmed, "{", "}");
  if (objectSlice) {
    const parsed = tryParse(objectSlice);
    if (parsed.ok) return parsed.value;
  }

  throw new Error("Model response did not contain parseable JSON.");
}

export function parseJsonArrayFromLlm(
  raw: string,
  arrayKeys: string[] = ["events", "items", "data"],
): unknown[] {
  const parsed = parseJsonFromLlm(raw);

  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    for (const key of arrayKeys) {
      if (Array.isArray(record[key])) {
        return record[key] as unknown[];
      }
    }
  }

  throw new Error("Expected JSON array (or object containing an array payload).");
}

function tryParse(value: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch {
    return { ok: false };
  }
}

function extractFencedContent(value: string): string | null {
  const match = value.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return match?.[1]?.trim() ?? null;
}

function extractBracketSlice(value: string, open: string, close: string): string | null {
  const start = value.indexOf(open);
  const end = value.lastIndexOf(close);
  if (start < 0 || end <= start) return null;
  return value.slice(start, end + 1).trim();
}
