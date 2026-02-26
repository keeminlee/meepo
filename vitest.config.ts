import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["src/tests/setup.ts"],
    include: [
      "src/tests/test-campaign-db-isolation.ts",
      "src/tests/test-guild-mapping-auto-create.ts",
      "src/tests/test-stopline-no-getdb-runtime.ts",
      "src/tests/test-voice-playback-controller.ts",
      "src/tests/test-transcript-system-isolation.ts",
      "src/tests/test-transcript-bronze-view-contract.ts",
      "src/tests/test-silver-seq-determinism.ts",
      "src/tests/test-silver-seq-metrics-contract.ts",
      "src/tests/test-eligibility-mask-parity-c2e20.ts",
      "src/tests/test-megameecap-dry-run-determinism.ts",
      "src/tests/test-megameecap-context-bounds.ts",
      "src/tests/megameecap/segmenter.test.ts",
      "src/tests/megameecap/contextCarry.test.ts",
      "src/tests/megameecap/prompts.segment.test.ts",
      "src/tests/megameecap/prompts.final.test.ts",
      "src/tests/megameecap/orchestrator.test.ts",
      "src/tests/megameecap/io.test.ts",
      "src/tests/registry/test-scan-names.ts",
      "src/tests/registry/test-review-names.ts",
      "src/tests/smoke/test-megameecap-fixture.ts",
      "src/tests/smoke/test-silver-seq-fixture.ts",
      "src/tests/voice/test-voice-interrupt.ts",
      "src/tests/test-receiver-stop-phrase-bypass.ts",
      "src/tests/test-receiver-gating.ts",
      "src/tests/test-receiver-rejected-path.ts",
    ],
    sequence: {
      concurrent: false,
    },
    testTimeout: 30000,
  },
});
