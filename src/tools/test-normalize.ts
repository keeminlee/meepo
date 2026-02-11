import { normalizeText } from "../registry/normalizeText.js";

/**
 * Quick test harness for Phase 1C normalizer.
 * Run: npx tsx src/tools/test-normalize.ts
 */

const testCases = [
  {
    input: "Don't worry, Ira, I've got a very good feeling about this.",
    expected: "Don't worry, Uriah, I've got a very good feeling about this.",
    description: "Ira → Uriah (NPC alias)",
  },
  {
    input: "Sir Calvus rode into battle.",
    expected: "Sir Caldus rode into battle.",
    description: "Sir Calvus → Sir Caldus (NPC alias)",
  },
  {
    input: "James said hello to Minx.",
    expected: "Jamison said hello to Minx.",
    description: "James → Jamison (PC alias)",
  },
  {
    input: "Jamison and James went together.",
    expected: "Jamison and Jamison went together.",
    description: "Multiple aliases of same person",
  },
  {
    input: "We traveled to Waterdeep.",
    expected: "We traveled to Waterdeep.",
    description: "Waterdeep (location, no change)",
  },
  {
    input: "Louis and Snowflake explored the city.",
    expected: "Louis and Snowflake explored the city.",
    description: "Canonical names unchanged",
  },
  {
    input: "Ser Calvus met with Cyril and Evanora.",
    expected: "Sir Caldus met with Cyril and Evanora.",
    description: "Ser Calvus → Sir Caldus (alternate alias)",
  },
];

console.log("🧪 Testing normalizeText()...\n");

let passed = 0;
let failed = 0;

for (const test of testCases) {
  const result = normalizeText(test.input);
  const success = result === test.expected;
  
  if (success) {
    console.log(`✅ ${test.description}`);
    passed++;
  } else {
    console.log(`❌ ${test.description}`);
    console.log(`   Input:    ${test.input}`);
    console.log(`   Expected: ${test.expected}`);
    console.log(`   Got:      ${result}`);
    failed++;
  }
}

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log("✅ All tests passed!");
} else {
  console.log(`❌ ${failed} test(s) failed`);
  process.exit(1);
}
