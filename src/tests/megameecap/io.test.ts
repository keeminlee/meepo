import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";

process.env.DISCORD_TOKEN ??= "test-token";
process.env.OPENAI_API_KEY ??= "test-openai-key";

async function loadIo() {
  return import("../../tools/megameecap/io.js");
}

test("io uses locked naming contract", async () => {
  const { baselineFilename, finalFilename, metaFilename } = await loadIo();

  expect(baselineFilename("C2E20")).toBe("megameecap_C2E20.md");
  expect(finalFilename("C2E20", "balanced")).toBe("megameecap_C2E20__final_balanced.md");
  expect(metaFilename("C2E20")).toBe("megameecap_C2E20.meta.json");
});

test("io writes baseline/final/meta in campaign-scoped output dir", async () => {
  const { readBaselineInput, writeMegameecapOutputs } = await loadIo();

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "megameecap-io-"));
  const outputDir = path.join(tempRoot, "exports", "meecaps");

  const writeResult = writeMegameecapOutputs({
    campaignSlug: "default",
    sessionLabel: "C2E20",
    baselineMarkdown: "# baseline",
    finalMarkdown: "# final",
    finalStyle: "detailed",
    outputDirOverride: outputDir,
    meta: {
      session: "C2E20",
      campaign: "default",
      generated_at: new Date().toISOString(),
      model: "test-model",
      segment_count: 2,
      segment_size: 250,
      total_input_lines: 500,
      total_output_chars: 1000,
      final_style: "detailed",
      timing: { segment_calls_ms: [10, 12], final_pass_ms: 15 },
    },
  });

  expect(writeResult.outputDir).toBe(path.resolve(outputDir));
  expect(fs.existsSync(writeResult.baselinePath)).toBe(true);
  expect(fs.existsSync(writeResult.finalPath!)).toBe(true);
  expect(fs.existsSync(writeResult.metaPath)).toBe(true);
  expect(readBaselineInput(writeResult.baselinePath)).toBe("# baseline");
});
