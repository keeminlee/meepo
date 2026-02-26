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
