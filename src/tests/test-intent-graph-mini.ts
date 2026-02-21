import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bundleYesNo } from "../causal/bundleYesNo.js";
import { extractIntentConsequenceNodes } from "../causal/extractIntentConsequenceNodes.js";
import { buildIdf } from "../causal/buildIdf.js";
import { scoreEdgesForward } from "../causal/scoreEdgesForward.js";
import { reweightEdgesBackward } from "../causal/reweightEdgesBackward.js";
import type { GraphParams } from "../causal/intentGraphTypes.js";

const fixturePath = new URL("./fixtures/intent-graph-mini.json", import.meta.url);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

const transcript = fixture.lines;
const chunks = fixture.chunks;
const actors = fixture.actors;

const isDm = (speaker: string) => /\(DM\)/i.test(speaker);

const bundled = bundleYesNo({
  sessionId: "S_TEST",
  transcript,
  actors,
  isDmSpeaker: isDm,
});

assert.equal(bundled.bundles.length, 1, "Expected one yes/no bundle");
assert.ok(bundled.consumedLineIndices.has(0), "DM prompt should be consumed");
assert.ok(bundled.consumedLineIndices.has(1), "PC yes/no reply should be consumed");

const nodes = extractIntentConsequenceNodes({
  sessionId: "S_TEST",
  transcript,
  chunks,
  masks: { oocHard: [], oocSoft: [], combat: [] },
  includeOocSoft: true,
  actors,
  isDmSpeaker: isDm,
  bundles: bundled.bundles,
  consumedLineIndices: bundled.consumedLineIndices,
  buffer: 10,
});

assert.ok(nodes.intents.some((n) => n.source === "bundle_yesno"), "Missing bundle intent node");
assert.ok(nodes.intents.every((n) => n.intent_id.startsWith("I:S_TEST:")), "Intent IDs must be deterministic");
assert.ok(
  nodes.consequences.every((n) => n.consequence_id.startsWith("C:S_TEST:")),
  "Consequence IDs must be deterministic"
);

const params: GraphParams = {
  buffer: 10,
  maxBack: 60,
  topK: 2,
  lambda: 0.12,
  alphaLex: 0.7,
  beta: 0.35,
  iters: 2,
  distTau: 2,
  distP: 2.2,
  lexK: 6,
  betaLex: 0.6,
};

const idf = buildIdf(transcript);
const edges = scoreEdgesForward({
  sessionId: "S_TEST",
  intents: nodes.intents,
  consequences: nodes.consequences,
  idf,
  actorsById: new Map(actors.map((a: any) => [a.id, a])),
  graphParams: params,
});

for (const c of nodes.consequences) {
  const incoming = edges.filter((e) => e.consequence_id === c.consequence_id);
  assert.ok(incoming.length <= params.topK, "topK cap violated");
}

const reweighted = reweightEdgesBackward(edges, params.beta, params.iters);
for (const c of nodes.consequences) {
  const incoming = reweighted.filter((e) => e.consequence_id === c.consequence_id);
  if (incoming.length < 2) continue;
  const sorted = incoming.slice().sort((a, b) => b.base_score - a.base_score);
  const top = sorted[0];
  const nonTop = sorted[1];
  assert.ok(nonTop.adjusted_score <= nonTop.base_score + 1e-9, "non-top edge should be downweighted");
  assert.ok(top.adjusted_score >= nonTop.adjusted_score, "top edge should dominate");
}

console.log("test-intent-graph-mini passed");
