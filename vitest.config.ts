import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["src/tests/setup.ts"],
    include: [
      "src/tests/test-campaign-db-isolation.ts",
      "src/tests/test-guild-mapping-auto-create.ts",
      "src/tests/test-stopline-no-getdb-runtime.ts",
    ],
    sequence: {
      concurrent: false,
    },
    testTimeout: 30000,
  },
});
