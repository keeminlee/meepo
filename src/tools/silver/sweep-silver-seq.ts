import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { getDbForCampaign } from "../../db.js";
import { getDefaultCampaignSlug } from "../../campaign/defaultCampaign.js";
import { buildTranscript } from "../../ledger/transcripts.js";
import { segmentTranscript } from "../../silver/seq/segmentTranscript.js";
import type { CombatMode } from "../../silver/seq/types.js";

type SweepRow = {
  target_lines: number;
  snap_window: number;
  combat_mode: CombatMode;
  numSegments: number;
  coverageNarrative: number;
  p50Narrative: number;
  p95Narrative: number;
};

function parseNumberList(value: string | undefined, fallback: number[]): number[] {
  if (!value) return fallback;
  return value
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x));
}

function parseArgs(): {
  sessionLabel: string;
  campaign: string;
  targetLinesGrid: number[];
  snapWindowGrid: number[];
  combatModes: CombatMode[];
  minLines: number;
  maxLines: number;
  pruneRegime: string;
} {
  const argv = process.argv.slice(2);

  let sessionLabel = "";
  let campaign = getDefaultCampaignSlug();
  let targetLinesGrid = [220, 240, 260];
  let snapWindowGrid = [20, 30, 40];
  let combatModes: CombatMode[] = ["prune", "include_not_counted"];
  let minLines = 180;
  let maxLines = 320;
  let pruneRegime = "v1_default";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--session" && argv[i + 1]) {
      sessionLabel = argv[++i];
    } else if (arg === "--campaign" && argv[i + 1]) {
      campaign = argv[++i];
    } else if (arg === "--target_lines" && argv[i + 1]) {
      targetLinesGrid = parseNumberList(argv[++i], targetLinesGrid);
    } else if (arg === "--snap_window" && argv[i + 1]) {
      snapWindowGrid = parseNumberList(argv[++i], snapWindowGrid);
    } else if (arg === "--combat_mode" && argv[i + 1]) {
      const parsed = argv[++i]
        .split(",")
        .map((item) => item.trim())
        .filter((item): item is CombatMode =>
          item === "prune" || item === "include" || item === "include_not_counted"
        );
      if (parsed.length > 0) combatModes = parsed;
    } else if (arg === "--min_lines" && argv[i + 1]) {
      minLines = Number(argv[++i]);
    } else if (arg === "--max_lines" && argv[i + 1]) {
      maxLines = Number(argv[++i]);
    } else if (arg === "--prune_regime" && argv[i + 1]) {
      pruneRegime = argv[++i];
    }
  }

  if (!sessionLabel) {
    throw new Error("Missing required argument: --session <SESSION_LABEL>");
  }

  return {
    sessionLabel,
    campaign,
    targetLinesGrid,
    snapWindowGrid,
    combatModes,
    minLines,
    maxLines,
    pruneRegime,
  };
}

function getSessionIdByLabel(sessionLabel: string, campaign: string): string {
  const db = getDbForCampaign(campaign);
  const row = db
    .prepare(
      `SELECT session_id
       FROM sessions
       WHERE label = ?
       ORDER BY created_at_ms DESC
       LIMIT 1`
    )
    .get(sessionLabel) as { session_id: string } | undefined;

  if (!row) throw new Error(`Session not found: ${sessionLabel}`);
  return row.session_id;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const db = getDbForCampaign(args.campaign);
  const sessionId = getSessionIdByLabel(args.sessionLabel, args.campaign);
  const transcript = buildTranscript(sessionId, { view: "bronze", primaryOnly: true }, db);

  const rows: SweepRow[] = [];
  for (const target of args.targetLinesGrid) {
    for (const snapWindow of args.snapWindowGrid) {
      for (const combatMode of args.combatModes) {
        const result = segmentTranscript({
          lines: transcript,
          targetNarrativeLines: target,
          minNarrativeLines: args.minLines,
          maxNarrativeLines: args.maxLines,
          snapWindow,
          combatMode,
          pruneRegime: args.pruneRegime,
        });

        rows.push({
          target_lines: target,
          snap_window: snapWindow,
          combat_mode: combatMode,
          numSegments: result.metrics.numSegments,
          coverageNarrative: result.metrics.coverageNarrative,
          p50Narrative: result.metrics.segmentNarrativeSizeDistribution.p50,
          p95Narrative: result.metrics.segmentNarrativeSizeDistribution.p95,
        });
      }
    }
  }

  rows.sort((a, b) => {
    if (b.coverageNarrative !== a.coverageNarrative) return b.coverageNarrative - a.coverageNarrative;
    if (Math.abs(a.p50Narrative - 250) !== Math.abs(b.p50Narrative - 250)) {
      return Math.abs(a.p50Narrative - 250) - Math.abs(b.p50Narrative - 250);
    }
    if (a.p95Narrative !== b.p95Narrative) return a.p95Narrative - b.p95Narrative;
    if (a.target_lines !== b.target_lines) return a.target_lines - b.target_lines;
    if (a.snap_window !== b.snap_window) return a.snap_window - b.snap_window;
    return a.combat_mode.localeCompare(b.combat_mode);
  });

  const outDir = path.join(process.cwd(), "data", "artifacts", "silver_seq", args.sessionLabel);
  fs.mkdirSync(outDir, { recursive: true });

  const outPath = path.join(outDir, `sweep_${Date.now()}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        session: args.sessionLabel,
        session_id: sessionId,
        campaign: args.campaign,
        rows,
      },
      null,
      2,
    ),
    "utf-8",
  );

  console.log(`✅ Wrote sweep report: ${outPath}`);
  console.log(`Top candidate:`, rows[0]);
}

main().catch((err) => {
  console.error("❌", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
