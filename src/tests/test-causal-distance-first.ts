import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildIdf, calibrateLexK } from "../causal/buildIdf.js";
import { scoreEdgesForward } from "../causal/scoreEdgesForward.js";
import type { ConsequenceNode, GraphParams, IntentNode } from "../causal/intentGraphTypes.js";
import { makeConsequenceId, makeIntentId } from "../causal/intentGraphTypes.js";
import { tokenizeKeywords } from "../causal/textFeatures.js";
import type { ActorLike } from "../causal/actorFeatures.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, "fixtures", "distance-first-fixture.json");
const fixtureRaw = readFileSync(fixturePath, "utf8");
const fixture = JSON.parse(fixtureRaw);

function buildMockTranscript() {
  return fixture.lines.map((line: any) => ({
    line_index: line.line_index,
    author_name: line.author_name,
    content: line.content,
  }));
}

function buildMockIntents(): IntentNode[] {
  const intent = fixture.expected.intent_at_232;
  return [
    {
      intent_id: makeIntentId(fixture.session_id, intent.actor_id, intent.anchor_index),
      session_id: fixture.session_id,
      chunk_id: "chunk_0",
      actor_id: intent.actor_id,
      anchor_index: intent.anchor_index,
      intent_type: "question",
      text: intent.text,
      source: "pc_line",
    },
  ];
}

function buildMockConsequences(): ConsequenceNode[] {
  const dmLines = fixture.lines.filter((line: any) => line.author_name === "DM");
  return dmLines.map((line: any) => ({
    consequence_id: makeConsequenceId(fixture.session_id, line.line_index),
    session_id: fixture.session_id,
    chunk_id: "chunk_0",
    anchor_index: line.line_index,
    consequence_type: "information" as const,
    text: line.content,
  }));
}

function testDistanceFirstScoring() {
  const transcript = buildMockTranscript();
  const intents = buildMockIntents();
  const consequences = buildMockConsequences();

  const idf = buildIdf(transcript);
  const lexK = calibrateLexK(transcript, idf, 60);

  const graphParams: GraphParams = {
    buffer: 10,
    maxBack: 60,
    topK: 12,
    lambda: 0.12, // deprecated
    alphaLex: 0.7, // deprecated
    beta: 0.35,
    iters: 2,
    distTau: 2,
    distP: 2.2,
    lexK,
    betaLex: 0.6,
  };

  const actorsById = new Map<string, ActorLike>(
    fixture.actors.map((a: any) => [
      a.id,
      {
        id: a.id,
        canonical_name: a.canonical_name,
        aliases: a.aliases,
      },
    ])
  );

  const edges = scoreEdgesForward({
    sessionId: fixture.session_id,
    intents,
    consequences,
    idf,
    actorsById,
    graphParams,
  });

  // Filter edges for the intent at L232
  const intent232Id = makeIntentId(fixture.session_id, "pc_snowflake", 232);
  const edgesFor232 = edges.filter((e) => e.intent_id === intent232Id);

  if (edgesFor232.length === 0) {
    throw new Error("No edges found for intent at L232");
  }

  // Sort by base_score
  edgesFor232.sort((a, b) => b.base_score - a.base_score);

  const topConsequenceId = edgesFor232[0].consequence_id;
  const topConsequenceAnchor = consequences.find((c) => c.consequence_id === topConsequenceId)?.anchor_index;

  console.log(`\n=== Distance-First Scoring Test ===`);
  console.log(`Intent at L232: "${fixture.expected.intent_at_232.text}"`);
  console.log(`Calibrated lexK: ${lexK.toFixed(2)}\n`);

  console.log(`Candidate consequences for L232:`);
  for (const edge of edgesFor232) {
    const cons = consequences.find((c) => c.consequence_id === edge.consequence_id);
    if (!cons) continue;
    const lexRaw = edge.lexical_score;
    const lexNorm = lexRaw / (lexRaw + lexK);
    console.log(
      `  L${cons.anchor_index} [score=${edge.base_score.toFixed(3)}] d=${edge.distance} dist=${edge.distance_score.toFixed(3)} lexRaw=${lexRaw.toFixed(2)} lexNorm=${lexNorm.toFixed(3)}`
    );
    console.log(`    terms: [${edge.shared_terms.join(", ")}]`);
    console.log(`    "${cons.text.slice(0, 80)}${cons.text.length > 80 ? "..." : ""}"`);
  }

  console.log(`\nTop consequence: L${topConsequenceAnchor}`);
  console.log(`Expected: L${fixture.expected.top_consequence_should_be}`);

  if (topConsequenceAnchor !== fixture.expected.top_consequence_should_be) {
    throw new Error(
      `Expected top consequence at L${fixture.expected.top_consequence_should_be}, but got L${topConsequenceAnchor}`
    );
  }

  console.log(`\n✅ Distance-first scoring test PASSED`);
  console.log(`   L234 "He's in custody" correctly wins over L237 (longer commentary) despite lower lexical overlap`);
}

// Run test
try {
  testDistanceFirstScoring();
  console.log("\nEXIT:0");
} catch (err) {
  console.error("\n❌ Test FAILED:");
  console.error(err instanceof Error ? err.message : err);
  console.log("\nEXIT:1");
  process.exit(1);
}
