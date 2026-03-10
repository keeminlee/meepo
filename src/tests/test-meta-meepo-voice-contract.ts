import { describe, expect, test } from "vitest";
import { META_VOICE_VERSION, metaMeepoVoice } from "../ui/metaMeepoVoice.js";

function extractHeaders(text: string): string[] {
  return Array.from(text.matchAll(/\*\*([^*]+)\*\*/g)).map((match) => match[1]);
}

describe("metaMeepoVoice contract", () => {
  test("exports versioned tone rail", () => {
    expect(META_VOICE_VERSION).toBe(1);
  });

  test("status snapshot keeps core structural sections", () => {
    const output = metaMeepoVoice.status.snapshot({
      lifecycleState: "Showtime Active",
      voiceState: "Connected",
      session: "C2E21 (active)",
      campaign: "default",
      nextStep: "Use /meepo showtime end when the session is over.",
      isDevUser: true,
      devDiagnosticsLines: ["Runtime mode: ambient"],
      legacyLabNotes: ["Lab diagnostics available in /lab."],
    });

    const headers = extractHeaders(output);
    expect(headers).toEqual([
      "Main Status",
      "Dev Diagnostics",
      "Legacy / Lab Notes",
    ]);
  });

  test("status snapshot hides dev sections for non-dev viewers", () => {
    const output = metaMeepoVoice.status.snapshot({
      lifecycleState: "Ready",
      voiceState: "Not connected",
      session: "No active session",
      campaign: "default",
      nextStep: "Use /meepo showtime start to begin a session.",
      isDevUser: false,
      devDiagnosticsLines: ["Runtime mode: ambient"],
      legacyLabNotes: ["Lab diagnostics available in /lab."],
    });

    expect(output).toContain("**Main Status**");
    expect(output).not.toContain("**Dev Diagnostics**");
    expect(output).not.toContain("**Legacy / Lab Notes**");
  });

  test("status snapshot renders campaign DM roster in public section", () => {
    const output = metaMeepoVoice.status.snapshot({
      lifecycleState: "Ready",
      voiceState: "Connected",
      session: "No active session",
      campaign: "campaign_alpha",
      campaignDmLines: ["- Campaign Alpha (campaign_alpha): DM One"],
      nextStep: "Use /meepo showtime start to begin a session.",
      isDevUser: false,
    });

    expect(output).toContain("**Campaign DMs**");
    expect(output).toContain("Campaign Alpha (campaign_alpha): DM One");
    expect(output).not.toContain("(12345)");
  });

  test("sessions view output keeps core section anchors", () => {
    const lines = metaMeepoVoice.sessions.viewLines({
      sessionId: "session-1",
      label: "C2E21",
      startedIso: "2026-03-03T00:00:00.000Z",
      endedIso: "(active)",
      kind: "canon",
      baseExists: true,
      baseHash: "abc123",
      baseVersion: "megameecap-base-v1",
      recapExists: true,
      finalStyle: "balanced",
      finalCreatedAt: "2026-03-03T00:10:00.000Z",
      finalHash: "def456",
      finalVersion: "megameecap-final-v1",
      linkedBaseVersion: "megameecap-base-v1",
      transcriptStatus: "available",
      dbRowMissingFileNotice: false,
      hasUnindexedFilesNotice: false,
      nextActionLine: "Next: Regenerate via /meepo sessions recap ...",
      transcriptMissingNotice: false,
    });

    const output = lines.join("\n");
    const headers = extractHeaders(output);
    expect(headers).toEqual(["Session", "Recap memory", "Transcript"]);
  });
});
