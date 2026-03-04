import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

describe("no direct meepomind access in reply paths", () => {
  test("bot and voice reply paths do not import meepo-mind directly", () => {
    const botPath = path.resolve("src/bot.ts");
    const voicePath = path.resolve("src/voice/voiceReply.ts");

    const botSource = fs.readFileSync(botPath, "utf8");
    const voiceSource = fs.readFileSync(voicePath, "utf8");

    expect(botSource).not.toContain("ledger/meepo-mind");
    expect(voiceSource).not.toContain("ledger/meepo-mind");
  });
});
