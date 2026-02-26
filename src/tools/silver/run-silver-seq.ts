import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { getDbForCampaign } from "../../db.js";
import { getDefaultCampaignSlug } from "../../campaign/defaultCampaign.js";
import { buildTranscript } from "../../ledger/transcripts.js";
import { classifyLineKind } from "../../silver/seq/classifyLineKind.js";
import { segmentTranscript } from "../../silver/seq/segmentTranscript.js";
import type { CombatMode } from "../../silver/seq/types.js";

interface Args {
  sessionLabel: string;
  targetLines: number;
  minLines: number;
  maxLines: number;
  snapWindow: number;
  combatMode: CombatMode;
  pruneRegime: string;
  campaign: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);

  let sessionLabel = "";
  let targetLines = 250;
  let minLines = 200;
  let maxLines = 300;
  let snapWindow = 25;
  let combatMode: CombatMode = "prune";
  let pruneRegime = "v1_default";
  let campaign = getDefaultCampaignSlug();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--session" && argv[i + 1]) {
      sessionLabel = argv[++i];
    } else if (arg === "--target_lines" && argv[i + 1]) {
      targetLines = Number(argv[++i]);
    } else if (arg === "--min_lines" && argv[i + 1]) {
      minLines = Number(argv[++i]);
    } else if (arg === "--max_lines" && argv[i + 1]) {
      maxLines = Number(argv[++i]);
    } else if (arg === "--snap_window" && argv[i + 1]) {
      snapWindow = Number(argv[++i]);
    } else if (arg === "--combat_mode" && argv[i + 1]) {
      const mode = argv[++i] as CombatMode;
      if (mode === "prune" || mode === "include" || mode === "include_not_counted") {
        combatMode = mode;
      }
    } else if (arg === "--prune_regime" && argv[i + 1]) {
      pruneRegime = argv[++i];
    } else if (arg === "--campaign" && argv[i + 1]) {
      campaign = argv[++i];
    }
  }

  if (!sessionLabel) {
    throw new Error("Missing required argument: --session <SESSION_LABEL>");
  }

  return {
    sessionLabel,
    targetLines,
    minLines,
    maxLines,
    snapWindow,
    combatMode,
    pruneRegime,
    campaign,
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

  if (!row) {
    throw new Error(`Session not found: ${sessionLabel}`);
  }

  return row.session_id;
}

function stableHash(value: unknown): string {
  const serialized = JSON.stringify(value);
  return createHash("sha256").update(serialized).digest("hex");
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}

async function main(): Promise<void> {
  const args = parseArgs();
  const sessionId = getSessionIdByLabel(args.sessionLabel, args.campaign);
  const transcript = buildTranscript(sessionId, { view: "bronze", primaryOnly: true }, getDbForCampaign(args.campaign));

  const result = segmentTranscript({
    lines: transcript,
    targetNarrativeLines: args.targetLines,
    minNarrativeLines: args.minLines,
    maxNarrativeLines: args.maxLines,
    snapWindow: args.snapWindow,
    combatMode: args.combatMode,
    pruneRegime: args.pruneRegime,
  });

  const runId = `run_${Date.now()}`;
  const outDir = path.join(
    process.cwd(),
    "data",
    "artifacts",
    "silver_seq",
    args.sessionLabel,
    runId,
  );
  fs.mkdirSync(outDir, { recursive: true });

  const params = {
    session: args.sessionLabel,
    session_id: sessionId,
    target_lines: args.targetLines,
    min_lines: args.minLines,
    max_lines: args.maxLines,
    snap_window: args.snapWindow,
    combat_mode: args.combatMode,
    prune_regime: args.pruneRegime,
    campaign: args.campaign,
  };

  const eligibleMask = transcript.map((line, index) => {
    const kind = classifyLineKind(line);
    const included =
      kind === "narrative" ||
      (kind === "combat" && (args.combatMode === "include" || args.combatMode === "include_not_counted"));

    return {
      line_index: index,
      kind,
      included,
      counted: kind === "narrative" || (kind === "combat" && args.combatMode === "include"),
    };
  });

  const transcriptHash = {
    session: args.sessionLabel,
    session_id: sessionId,
    hash: stableHash(
      transcript.map((line) => ({
        line_index: line.line_index,
        author_name: line.author_name,
        content: line.content,
        timestamp_ms: line.timestamp_ms,
        source_type: line.source_type ?? null,
        source_ids: line.source_ids ?? [],
      }))
    ),
  };

  writeJson(path.join(outDir, "params.json"), params);
  writeJson(path.join(outDir, "transcript_hash.json"), transcriptHash);
  writeJson(path.join(outDir, "eligible_mask.json"), eligibleMask);
  writeJson(path.join(outDir, "segments.json"), { segments: result.segments });
  writeJson(path.join(outDir, "metrics.json"), result.metrics);

  console.log(`✅ Silver-Seq artifacts written: ${outDir}`);
  console.log(`Segments: ${result.segments.length}`);
  console.log(`Coverage narrative: ${result.metrics.coverageNarrative}`);
}

main().catch((err) => {
  console.error("❌", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
