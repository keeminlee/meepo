import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import type { TranscriptLine } from "../../tools/megameecap/types.js";

process.env.DISCORD_TOKEN ??= "test-token";
process.env.OPENAI_API_KEY ??= "test-openai-key";

type FixtureTranscriptLine = {
  line_index: number;
  author_name: string;
  content: string;
};

type FixtureSession = {
  sessionLabel: string;
  campaign: string;
};

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function fixtureRoot(): string {
  return path.join(process.cwd(), "src", "tests", "fixtures", "sessions", "fixture_v1");
}

function loadFixtureSession(): FixtureSession {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot(), "session.json"), "utf-8")) as FixtureSession;
}

function loadFixtureTranscript(): TranscriptLine[] {
  const rows = JSON.parse(
    fs.readFileSync(path.join(fixtureRoot(), "transcript.json"), "utf-8"),
  ) as FixtureTranscriptLine[];

  return rows.map((row) => ({
    lineIndex: row.line_index,
    speaker: row.author_name,
    text: row.content,
  }));
}

function normalizeBaselineForHash(markdown: string): string {
  return markdown
    .replace(/- Generated: .*$/m, "- Generated: <normalized>")
    .replace(/\r\n/g, "\n");
}

test("smoke: MegaMeecap fixture generates deterministic shape and outputs", async () => {
  const { orchestrateMegaMeecap } = await import("../../tools/megameecap/orchestrate.js");
  const { writeMegameecapOutputs } = await import("../../tools/megameecap/io.js");

  const fixtureSession = loadFixtureSession();
  const lines = loadFixtureTranscript();

  const callLlm = async (input: { systemPrompt: string; userPrompt: string; model: string }) => {
    if (input.userPrompt.includes("Create the BALANCED final recap")) {
      return "Balanced final recap for fixture run.";
    }

    const segMatch = input.userPrompt.match(/SEG_(\d{4})/);
    const seg = segMatch?.[1] ?? "0000";
    return `- Segment ${seg}: decision recorded [L0-L1]\n- Segment ${seg}: consequence tracked [L2-L3]`;
  };

  const runA = await orchestrateMegaMeecap(
    {
      sessionLabel: fixtureSession.sessionLabel,
      campaign: fixtureSession.campaign,
      segmentSize: 4,
      maxLlmLines: 4,
      carryConfig: { maxCarryChars: 1200, maxCarrySegments: 2 },
      style: "balanced",
      noFinalPass: false,
      model: "fixture-model",
      lines,
    },
    { callLlm },
  );

  const runB = await orchestrateMegaMeecap(
    {
      sessionLabel: fixtureSession.sessionLabel,
      campaign: fixtureSession.campaign,
      segmentSize: 4,
      maxLlmLines: 4,
      carryConfig: { maxCarryChars: 1200, maxCarrySegments: 2 },
      style: "balanced",
      noFinalPass: false,
      model: "fixture-model",
      lines,
    },
    { callLlm },
  );

  expect(runA.segmentLogs.length).toBeGreaterThan(0);
  expect(runA.meta.session).toBe("FIXTURE_V1");
  expect(runA.meta.campaign).toBe("default");
  expect(runA.meta.total_input_lines).toBe(lines.length);
  expect(runA.finalMarkdown).toContain("Balanced final recap");
  expect(runA.baselineMarkdown).toContain("- Transcript view: bronze");

  expect(runA.segmentLogs.map((s) => s.segmentId)).toEqual(runB.segmentLogs.map((s) => s.segmentId));
  expect(stableHash(normalizeBaselineForHash(runA.baselineMarkdown))).toBe(
    stableHash(normalizeBaselineForHash(runB.baselineMarkdown)),
  );

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "megameecap-smoke-"));
  const writeResult = writeMegameecapOutputs({
    campaignSlug: fixtureSession.campaign,
    sessionLabel: fixtureSession.sessionLabel,
    baselineMarkdown: runA.baselineMarkdown,
    finalMarkdown: runA.finalMarkdown,
    finalStyle: "balanced",
    meta: runA.meta,
    outputDirOverride: outDir,
  });

  expect(fs.existsSync(writeResult.baselinePath)).toBe(true);
  expect(fs.existsSync(writeResult.metaPath)).toBe(true);
  expect(writeResult.finalPath).not.toBeNull();
  expect(fs.existsSync(writeResult.finalPath!)).toBe(true);
});