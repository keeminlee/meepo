import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import { classifyLineKind } from "../../silver/seq/classifyLineKind.js";
import { segmentTranscript } from "../../silver/seq/segmentTranscript.js";
import type { TranscriptEntry } from "../../ledger/transcripts.js";

type FixtureSession = {
  sessionLabel: string;
  campaign: string;
};

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function fixtureRoot(): string {
  return path.join(process.cwd(), "data", "fixtures", "sessions", "fixture_v1");
}

function loadFixtureSession(): FixtureSession {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot(), "session.json"), "utf-8")) as FixtureSession;
}

function loadFixtureTranscript(): TranscriptEntry[] {
  return JSON.parse(
    fs.readFileSync(path.join(fixtureRoot(), "transcript.json"), "utf-8"),
  ) as TranscriptEntry[];
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}

test("smoke: Silver-Seq fixture produces deterministic artifacts", () => {
  const fixtureSession = loadFixtureSession();
  const transcript = loadFixtureTranscript();

  const runA = segmentTranscript({
    lines: transcript,
    targetNarrativeLines: 4,
    minNarrativeLines: 3,
    maxNarrativeLines: 5,
    snapWindow: 1,
    combatMode: "prune",
    pruneRegime: "v1_default",
  });

  const runB = segmentTranscript({
    lines: transcript,
    targetNarrativeLines: 4,
    minNarrativeLines: 3,
    maxNarrativeLines: 5,
    snapWindow: 1,
    combatMode: "prune",
    pruneRegime: "v1_default",
  });

  expect(stableHash(runA)).toBe(stableHash(runB));
  expect(runA.metrics.numSegments).toBeGreaterThan(0);
  expect(runA.metrics.coverageNarrative).toBeGreaterThanOrEqual(0);
  expect(runA.metrics.coverageNarrative).toBeLessThanOrEqual(1);

  const eligibleMask = transcript.map((line, index) => {
    const kind = classifyLineKind(line);
    return {
      line_index: index,
      kind,
      included: kind === "narrative",
      counted: kind === "narrative",
    };
  });

  const params = {
    session: fixtureSession.sessionLabel,
    campaign: fixtureSession.campaign,
    target_lines: 4,
    min_lines: 3,
    max_lines: 5,
    snap_window: 1,
    combat_mode: "prune",
    prune_regime: "v1_default",
  };

  const transcriptHash = {
    session: fixtureSession.sessionLabel,
    hash: stableHash(
      transcript.map((line) => ({
        line_index: line.line_index,
        author_name: line.author_name,
        content: line.content,
        timestamp_ms: line.timestamp_ms,
      })),
    ),
  };

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "silver-seq-smoke-"));
  writeJson(path.join(outDir, "params.json"), params);
  writeJson(path.join(outDir, "transcript_hash.json"), transcriptHash);
  writeJson(path.join(outDir, "eligible_mask.json"), eligibleMask);
  writeJson(path.join(outDir, "segments.json"), { segments: runA.segments });
  writeJson(path.join(outDir, "metrics.json"), runA.metrics);

  expect(fs.existsSync(path.join(outDir, "params.json"))).toBe(true);
  expect(fs.existsSync(path.join(outDir, "transcript_hash.json"))).toBe(true);
  expect(fs.existsSync(path.join(outDir, "eligible_mask.json"))).toBe(true);
  expect(fs.existsSync(path.join(outDir, "segments.json"))).toBe(true);
  expect(fs.existsSync(path.join(outDir, "metrics.json"))).toBe(true);
});