import { expect, test } from "vitest";
import { pickTranscriptRows, scanNamesCore } from "../../registry/scanNamesCore.js";

const alice = {
  id: "npc_alice",
  canonical_name: "Alice",
  aliases: ["Al"],
  type: "npc" as const,
};

function makeRegistry() {
  return {
    characters: [alice],
    ignore: new Set<string>(["the", "and", "thanks"]),
    byName: new Map<string, any>([
      ["alice", alice],
      ["al", alice],
    ]),
  };
}

test("scanNamesCore yields deterministic candidate ordering", () => {
  const registry = makeRegistry();
  const rows = [
    { content: "Bob Stone and Cara Vale enter.", narrative_weight: "primary", source: "voice" },
    { content: "Cara Vale and Bob Stone argue.", narrative_weight: "elevated", source: "voice" },
    { content: "The Keep is dark.", narrative_weight: "primary", source: "voice" },
  ];

  const output = scanNamesCore({
    rows,
    registry,
    minCount: 2,
    maxExamples: 2,
    includeKnown: false,
  });

  expect(output.pending.map((item) => item.key)).toEqual(["bob stone", "cara vale"]);
  expect(output.pending[0]?.count).toBe(2);
  expect(output.pending[1]?.count).toBe(2);
  expect(output.knownHits).toEqual([]);
});

test("scanNamesCore aggregates known hits when requested", () => {
  const registry = makeRegistry();
  const rows = [
    { content: "Alice meets the party.", narrative_weight: "primary", source: "voice" },
    { content: "Al returns with news.", narrative_weight: "elevated", source: "voice" },
    { content: "Alice and Al both speak.", narrative_weight: "primary", source: "voice" },
  ];

  const output = scanNamesCore({
    rows,
    registry,
    minCount: 99,
    maxExamples: 3,
    includeKnown: true,
  });

  expect(output.pending).toEqual([]);
  expect(output.knownHits).toEqual([
    {
      canonical_name: "Alice",
      count: 4,
      primaryCount: 4,
    },
  ]);
});

test("pickTranscriptRows uses bronze only when ledger is empty", () => {
  const ledgerRows = [{ content: "ledger", narrative_weight: "primary", source: "ledger" }];
  const bronzeRows = [{ content: "bronze", narrative_weight: "primary", source: "bronze" }];

  const preferred = pickTranscriptRows(ledgerRows, bronzeRows);
  expect(preferred.source).toBe("ledger_entries");
  expect(preferred.rows).toEqual(ledgerRows);

  const fallback = pickTranscriptRows([], bronzeRows);
  expect(fallback.source).toBe("bronze_transcript");
  expect(fallback.rows).toEqual(bronzeRows);
});
