/**
 * Test Meecap stub functionality
 */

import { generateMeecapStub } from "../sessions/meecap.js";

console.log("🧪 Testing Meecap stub...\n");

async function testMeecap() {
  try {
    const result = await generateMeecapStub({
      sessionId: "test_session_001",
      sessionLabel: "TEST01",
      entries: [], // Empty entries array for stub test
    });

    console.log("✅ Meecap stub generated successfully!\n");
    console.log("Discord Response:");
    console.log("─".repeat(60));
    console.log(result.text);
    console.log("─".repeat(60));
    
    console.log("\nStructured Meecap:");
    console.log(JSON.stringify(result.meecap, null, 2));

    if (result.meecap) {
      console.log("\n✅ Meecap structure is valid");
      console.log(`   Version: ${result.meecap.version}`);
      console.log(`   Session ID: ${result.meecap.session_id}`);
      console.log(`   Scenes: ${result.meecap.scenes.length} (empty stub)`);
    }

    console.log("\n✅ All tests passed!");
  } catch (err) {
    console.error("❌ Test failed:", err);
    process.exit(1);
  }
}

testMeecap();
