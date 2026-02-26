import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEPRECATED_KEYS = ["DEBUG_LATCH", "DB_PATH", "TTS_MAX_CHARS_PER_CHUNK"] as const;

const emptyDotenvPath = path.join(os.tmpdir(), "meepo-vitest-empty.env");
if (!fs.existsSync(emptyDotenvPath)) {
  fs.writeFileSync(emptyDotenvPath, "", "utf8");
}

process.env.DOTENV_CONFIG_PATH = emptyDotenvPath;
process.env.DOTENV_CONFIG_OVERRIDE = "false";

for (const key of DEPRECATED_KEYS) {
  if (process.env[key] !== undefined) {
    delete process.env[key];
  }
}

process.env.MIGRATIONS_SILENT = "1";
process.env.NODE_ENV = "test";
