import fs from "node:fs";
import path from "node:path";
import {
  generateRegimeMasks,
  type RegimeChunk,
  type RegimeMaskOptions,
} from "../causal/pruneRegimes.js";
import type { TranscriptEntry } from "../ledger/transcripts.js";

type Fixture = {
  transcript: TranscriptEntry[];
  chunks: RegimeChunk[];
  expected: {
    oocHard: Array<{ start_index: number; end_index: number }>;
    oocSoft: Array<{ start_index: number; end_index: number }>;
    combat: Array<{ start_index: number; end_index: number }>;
  };
};

function toRangeKey(span: { start_index: number; end_index: number }): string {
  return `${span.start_index}-${span.end_index}`;
}

function assertSameRanges(
  label: string,
  actual: Array<{ start_index: number; end_index: number }>,
  expected: Array<{ start_index: number; end_index: number }>
) {
  const actualKeys = actual.map(toRangeKey).sort();
  const expectedKeys = expected.map(toRangeKey).sort();

  if (actualKeys.length !== expectedKeys.length) {
    throw new Error(
      `${label}: expected ${expectedKeys.length} span(s), got ${actualKeys.length}`
    );
  }

  for (let i = 0; i < expectedKeys.length; i++) {
    if (actualKeys[i] !== expectedKeys[i]) {
      throw new Error(`${label}: mismatch at ${i}: ${actualKeys[i]} vs ${expectedKeys[i]}`);
    }
  }
}

const fixturePath = path.join(
  process.cwd(),
  "src",
  "tests",
  "fixtures",
  "pruning-mini.json"
);

const raw = fs.readFileSync(fixturePath, "utf-8");
const fixture = JSON.parse(raw) as Fixture;

const opts: RegimeMaskOptions = {
  alternationThreshold: 0.5,
  combatDensityThreshold: 0.01,
  combatDensityLow: 0.002,
};

const masks = generateRegimeMasks(fixture.chunks, fixture.transcript, opts);

assertSameRanges("oocHard", masks.oocHard, fixture.expected.oocHard);
assertSameRanges("oocSoft", masks.oocSoft, fixture.expected.oocSoft);
assertSameRanges("combat", masks.combat, fixture.expected.combat);

console.log("✅ test-prune-regimes passed");
