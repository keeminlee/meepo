import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";

test("stopline:recap-service-boundary fails when command imports recapEngine and calls direct generation", () => {
  const tempFile = path.join(process.cwd(), "src", "commands", `__recap_boundary_probe_${Date.now()}.ts`);
  const source = [
    'import { generateSessionRecap } from "../sessions/recapEngine.js";',
    "",
    "export async function probe(): Promise<void> {",
    '  await generateSessionRecap({ guildId: "g", sessionId: "s", strategy: "balanced" });',
    "}",
    "",
  ].join("\n");

  fs.writeFileSync(tempFile, source, "utf8");

  try {
    const command = process.platform === "win32" ? "npm.cmd" : "npm";
    const result = spawnSync(command, ["run", "stopline:recap-service-boundary"], {
      cwd: process.cwd(),
      encoding: "utf8",
      shell: false,
    });

    expect(result.status).not.toBe(0);
  } finally {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  }
});
