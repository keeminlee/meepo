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
      setupVersion: 1,
      awake: true,
      voiceMode: "hush",
      effectiveMode: "ambient",
      canonMode: "meta",
      dmBinding: "<@dm-1> (dm-1)",
      configuredCanonPersona: "(auto)",
      effectivePersonaDisplayName: "Meta Meepo",
      effectivePersonaId: "meta_meepo",
      activeSessionId: "session-1",
      activeSessionSummary: "C2E21 (active)",
      homeText: "<#text>",
      homeVoice: "<#voice>",
      inVoice: false,
      connectedVoice: "(unset)",
      sttActive: false,
      sttProviderName: "noop",
      lastTranscription: "(none)",
      baseRecapCached: true,
      finalStyle: "balanced",
      finalCreatedAt: "2026-03-03T00:00:00.000Z",
      finalHash: "abcdef0123456789",
      ttsAvailable: false,
      ttsProviderName: "noop",
      hints: ["join voice"],
    });

    const headers = extractHeaders(output);
    expect(headers).toEqual([
      "Status",
      "Persona",
      "Session",
      "Home",
      "Voice + STT",
      "Recap",
      "TTS",
      "Hints",
    ]);
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
