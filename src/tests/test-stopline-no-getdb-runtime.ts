import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";

test("stopline:no-getdb-runtime fails when src file uses getDb()", () => {
  const tempFile = path.join(process.cwd(), "src", `__stopline_probe_${Date.now()}.ts`);
  const source = [
    'import { getDb } from "./db.js";',
    "export function probe(): void {",
    "  getDb();",
    "}",
    "",
  ].join("\n");

  fs.writeFileSync(tempFile, source, "utf8");

  try {
    const command = process.platform === "win32" ? "npm.cmd" : "npm";
    const result = spawnSync(command, ["run", "stopline:no-getdb-runtime"], {
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
