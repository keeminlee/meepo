import { createHash } from "node:crypto";
import type { CausalLinksRunMeta } from "../causal/persistCausalLinks.js";

export type ProvenanceSource = "db" | "recomputed";

export interface ProvenanceOptions {
  showParams?: boolean;
}

function formatTimestampNy(ms: number | null): string {
  if (ms === null) return "n/a";
  const dt = new Date(ms);
  const human = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).format(dt);
  return `${ms} (${human})`;
}

function hashParams(json: string | null): string {
  if (!json) return "n/a";
  return createHash("sha256").update(json, "utf8").digest("hex").slice(0, 12);
}

export function formatCausalLinksProvenance(
  meta: CausalLinksRunMeta | null,
  source: ProvenanceSource,
  opts: ProvenanceOptions = {},
): string[] {
  const showParams = opts.showParams ?? false;
  const lines: string[] = [];

  lines.push("Causal Links Provenance");
  lines.push(`- source: ${source}`);
  lines.push(`- session_id: ${meta?.session_id ?? "n/a"}`);
  lines.push(`- rows: ${meta?.row_count ?? 0}`);
  lines.push(`- kernel_version: ${meta?.kernel_version ?? "n/a"}`);
  lines.push(`- extracted_at: ${formatTimestampNy(meta?.extracted_at_ms ?? null)}`);

  if (showParams) {
    if (!meta?.kernel_params_json) {
      lines.push("- kernel_params_json: n/a");
    } else {
      lines.push("- kernel_params_json:");
      try {
        const parsed = JSON.parse(meta.kernel_params_json);
        const pretty = JSON.stringify(parsed, null, 2).split("\n");
        for (const line of pretty) {
          lines.push(`  ${line}`);
        }
      } catch {
        lines.push(`  ${meta.kernel_params_json}`);
      }
    }
  } else {
    lines.push(`- kernel_params: ${hashParams(meta?.kernel_params_json ?? null)} (use --showParams for full)`);
  }

  return lines;
}
