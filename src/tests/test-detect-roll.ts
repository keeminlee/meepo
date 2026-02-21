import { detectRollType } from "../causal/detectRoll.js";

const tests = [
  {
    input: "Make a Wisdom saving throw.",
    expected: { roll_type: "SavingThrow", roll_subtype: "Wisdom" },
    description: "Saving throw with ability",
  },
  {
    input: "Roll Investigation.",
    expected: { roll_type: "Investigation", roll_subtype: null },
    description: "Skill roll",
  },
  {
    input: "Make an attack roll.",
    expected: { roll_type: "AttackRoll", roll_subtype: null },
    description: "Attack roll",
  },
  {
    input: "Roll for initiative.",
    expected: { roll_type: "Initiative", roll_subtype: null },
    description: "Initiative roll",
  },
  {
    input: "Roll damage.",
    expected: { roll_type: "DamageRoll", roll_subtype: null },
    description: "Damage roll",
  },
  {
    input: "Just describe what you do next.",
    expected: { roll_type: null, roll_subtype: null },
    description: "No roll",
  },
];

console.log("🧪 Testing detectRollType()...\n");

let passed = 0;
let failed = 0;

for (const test of tests) {
  const result = detectRollType(test.input);
  const success =
    result.roll_type === test.expected.roll_type &&
    (result.roll_subtype ?? null) === test.expected.roll_subtype;

  if (success) {
    console.log(`✅ ${test.description}`);
    passed++;
  } else {
    console.log(`❌ ${test.description}`);
    console.log(`   Input:    ${test.input}`);
    console.log(`   Expected: ${JSON.stringify(test.expected)}`);
    console.log(`   Got:      ${JSON.stringify(result)}`);
    failed++;
  }
}

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log("✅ All tests passed!");
} else {
  process.exit(1);
}
