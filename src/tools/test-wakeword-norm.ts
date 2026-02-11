/**
 * Test: Verify wakeword detection still works after Phase 1C normalization
 */

import { normalizeText } from "../registry/normalizeText.js";
import { isAddressedToMeepo } from "../voice/wakeword.js";

console.log("🧪 Testing wakeword detection with normalization...\n");

const testCases = [
  { text: "Hey Meepo, what's up?", shouldTrigger: true },
  { text: "Meepo, can you help?", shouldTrigger: true },
  { text: "Meepo: tell me about Waterdeep", shouldTrigger: true },
  { text: "I think Meepo, you should know this", shouldTrigger: true },
  { text: "Meepo what do you think?", shouldTrigger: true },  // Starts with "meepo "
  { text: "Can Meepo help us?", shouldTrigger: false },  // Doesn't match wakeword patterns
  { text: "James said Meepo is cool", shouldTrigger: false },  // Meepo mentioned but not addressed
];

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
  const { text, shouldTrigger } = testCase;
  
  // Step 1: Normalize (simulates what happens in receiver.ts)
  const normalized = normalizeText(text);
  
  // Step 2: Check wakeword (simulates what happens after ledger insert)
  const isAddressed = isAddressedToMeepo(normalized);
  
  const success = isAddressed === shouldTrigger;
  
  if (success) {
    console.log(`✅ ${isAddressed ? "TRIGGERED" : "IGNORED "}: "${text}"`);
    if (normalized !== text) {
      console.log(`   (normalized: "${normalized}")`);
    }
    passed++;
  } else {
    console.log(`❌ ${isAddressed ? "TRIGGERED" : "IGNORED "}: "${text}" (expected ${shouldTrigger ? "trigger" : "ignore"})`);
    failed++;
  }
}

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);

if (failed === 0) {
  console.log("✅ Wakeword detection still works correctly after normalization!");
} else {
  console.log(`❌ ${failed} test(s) failed - normalization broke wakeword detection!`);
  process.exit(1);
}
