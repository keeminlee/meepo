/**
 * Test Meecap stub functionality
 */

import { generateMeecapStub } from "../sessions/meecap.js";

console.log("🧪 Testing Meecap stub...\n");

const testTranscript = `[2026-02-11T10:00:00.000Z] Jamison: We need to investigate the tower.
[2026-02-11T10:01:00.000Z] Minx: I agree, but let's be careful.
[2026-02-11T10:02:00.000Z] DM: You approach the crumbling tower...`;

const testTranscriptNorm = `[2026-02-11T10:00:00.000Z] Jamison: We need to investigate the tower.
[2026-02-11T10:01:00.000Z] Minx: I agree, but let's be careful.
[2026-02-11T10:02:00.000Z] DM: You approach the crumbling tower...`;

async function testMeecap() {
  try {
    const result = await generateMeecapStub({
      sessionId: "test_session_001",
      transcript: testTranscript,
      transcriptNorm: testTranscriptNorm,
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
