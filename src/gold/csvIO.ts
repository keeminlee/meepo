import fs from "node:fs";
import path from "node:path";

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let i = 0;
  let inQuotes = false;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "\"") {
      if (inQuotes && line[i + 1] === "\"") {
        cur += "\"";
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      i++;
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  out.push(cur);
  return out;
}

function toCsvCell(value: string): string {
  const needsQuote = value.includes(",") || value.includes("\"") || value.includes("\n") || value.includes("\r");
  if (!needsQuote) return value;
  return `"${value.replace(/"/g, "\"\"")}"`;
}

export function readCsvRows(filePath: string): Record<string, string>[] {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) {
      row[header[j]] = (cells[j] ?? "").trim();
    }
    rows.push(row);
  }
  return rows;
}

export function writeCsvRows(filePath: string, header: string[], rows: Record<string, string>[]): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const out: string[] = [];
  out.push(header.map(toCsvCell).join(","));
  for (const row of rows) {
    out.push(header.map((h) => toCsvCell(row[h] ?? "")).join(","));
  }
  fs.writeFileSync(filePath, out.join("\n") + "\n", "utf8");
}
